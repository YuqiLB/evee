import {SessionHub} from './session-hub';
import type {Env,Job} from './types';
import {authorized,error,json,owner,parseJson,requireString,streamToken,checkStreamToken} from './utils';
import {search} from './knowledge';
import {processJob} from './jobs';
import {elevenLabsConnection} from './elevenlabs';
export {SessionHub};

function match(path:string,re:RegExp){return path.match(re);}
async function checkedDataset(env:Env,id:string,ownerId:string){
  const d=await env.DB.prepare('SELECT * FROM datasets WHERE id=? AND owner_id=?').bind(id,ownerId).first<any>();
  if(!d)throw new Error('dataset_not_found');return d;
}
async function checkedSession(env:Env,id:string,ownerId:string){
  const s=await env.DB.prepare('SELECT * FROM sessions WHERE id=? AND owner_id=?').bind(id,ownerId).first<any>();
  if(!s)throw new Error('session_not_found');return s;
}
function safeMime(mime:string){return ['application/pdf','text/plain','text/markdown','text/csv','application/json','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(mime);}
const MAX_FILE=12*1024*1024;

async function appRoutes(request:Request,env:Env,url:URL):Promise<Response>{
  const path=url.pathname,method=request.method,ownerId=owner(request);
  let m:RegExpMatchArray|null;
  if(method==='POST'&&path==='/v1/elevenlabs/signed-url'){
    return elevenLabsConnection(env);
  }
  if(method==='POST'&&(m=match(path,/^\/v1\/sessions\/([\w-]+)\/elevenlabs$/))){
    const s=await checkedSession(env,m[1],ownerId);
    if(s.status!=='listening')return error('session_not_listening',409);
    return elevenLabsConnection(env,s.id);
  }
  if(method==='POST'&&path==='/v1/datasets'){
    const x=await parseJson(request);const name=requireString(x.name,'name',100);
    const replaces=x.replaces_dataset_id===undefined?null:requireString(x.replaces_dataset_id,'replaces_dataset_id');
    if(replaces)await checkedDataset(env,replaces,ownerId);
    const id=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO datasets(id,owner_id,name,replaces_dataset_id) VALUES(?,?,?,?)').bind(id,ownerId,name,replaces).run();
    return json({dataset_id:id,status:'draft',active_version:0},201);
  }
  if(method==='GET'&&(m=match(path,/^\/v1\/datasets\/([\w-]+)$/))){
    return json(await checkedDataset(env,m[1],ownerId));
  }
  if(method==='POST'&&(m=match(path,/^\/v1\/datasets\/([\w-]+)\/files$/))){
    const d=await checkedDataset(env,m[1],ownerId);
    if(d.processing_version!==null) return error('dataset_processing',409);
    const mime=(request.headers.get('content-type')||'').split(';')[0].trim();
    if(!safeMime(mime))return error('unsupported_content_type',415);
    const filename=requireString(request.headers.get('x-filename'),'filename',160);
    const length=Number(request.headers.get('content-length'));
    if(!Number.isInteger(length)||length<1||length>MAX_FILE)return error('file_size_not_supported',413,'Provide a positive Content-Length up to 12 MiB');
    if(!request.body)return error('file_body_required');
    const id=crypto.randomUUID(),key=`uploads/${d.id}/${id}`;
    const stored=await env.FILES.put(key,request.body,{httpMetadata:{contentType:mime},customMetadata:{filename}});
    if(!stored||stored.size>MAX_FILE){await env.FILES.delete(key);return error('file_size_not_supported',413);}
    try{
      await env.DB.prepare('INSERT INTO files(id,dataset_id,version_added,filename,mime_type,r2_key,bytes) VALUES(?,?,?,?,?,?,?)')
        .bind(id,d.id,d.active_version+1,filename,mime,key,length).run();
    }catch(e){await env.FILES.delete(key);throw e;}
    return json({file_id:id,dataset_id:d.id,version_added:d.active_version+1,bytes:length},201);
  }
  if(method==='POST'&&(m=match(path,/^\/v1\/datasets\/([\w-]+)\/process$/))){
    const d=await checkedDataset(env,m[1],ownerId);
    if(d.processing_version!==null)return error('dataset_processing',409);
    const version=d.active_version+1;
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE dataset_id=? AND version_added=?').bind(d.id,version).first<{n:number}>();
    if(!count?.n)return error('no_pending_files',409);
    const result=await env.DB.prepare('UPDATE datasets SET status=?,processing_version=? WHERE id=? AND processing_version IS NULL')
      .bind('processing',version,d.id).run();
    if(result.meta.changes!==1)return error('dataset_processing',409);
    const jobId=crypto.randomUUID();
    try{
      await env.DB.prepare('INSERT INTO jobs(id,owner_id,kind,resource_id) VALUES(?,?,?,?)').bind(jobId,ownerId,'ingest',d.id).run();
      await env.JOBS.send({kind:'ingest',jobId,datasetId:d.id,version});
    }catch(e){await env.DB.prepare('UPDATE datasets SET status=?,processing_version=NULL WHERE id=? AND processing_version=?').bind(d.active_version>0?'ready':'failed',d.id,version).run();throw e;}
    return json({job_id:jobId,dataset_id:d.id,version,status:'accepted'},202);
  }
  if(method==='GET'&&(m=match(path,/^\/v1\/jobs\/([\w-]+)$/))){
    const j=await env.DB.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').bind(m[1],ownerId).first<any>();
    if(!j)return error('job_not_found',404);
    return json({...j,result:j.result_json?JSON.parse(j.result_json):null,result_json:undefined});
  }
  if(method==='POST'&&path==='/v1/sessions'){
    const x=await parseJson(request);const d=await checkedDataset(env,requireString(x.dataset_id,'dataset_id'),ownerId);
    const version=x.dataset_version===undefined?d.active_version:Number(x.dataset_version);
    if(!Number.isInteger(version)||version<1||version>d.active_version)return error('dataset_not_ready',409);
    const id=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sessions(id,owner_id,dataset_id,dataset_version) VALUES(?,?,?,?)')
      .bind(id,ownerId,d.id,version).run();
    return json({session_id:id,dataset_id:d.id,dataset_version:version,status:'listening',stream_path:`/v1/sessions/${id}/stream`},201);
  }
  if(method==='POST'&&(m=match(path,/^\/v1\/sessions\/([\w-]+)\/stream-token$/))){
    const s=await checkedSession(env,m[1],ownerId);
    if(s.status!=='listening')return error('session_not_listening',409);
    const token=await streamToken(env.STREAM_SIGNING_KEY,s.id);
    return json({token,expires_in:60,path:`/v1/sessions/${s.id}/stream?token=${encodeURIComponent(token)}`});
  }
  if(method==='POST'&&(m=match(path,/^\/v1\/sessions\/([\w-]+)\/end$/))){
    const s=await checkedSession(env,m[1],ownerId);
    if(s.status!=='listening')return error('session_already_finalizing',409);
    const u=await env.DB.prepare("UPDATE sessions SET status='finalizing',ended_at=datetime('now') WHERE id=? AND status='listening'").bind(s.id).run();
    if(u.meta.changes!==1)return error('session_already_finalizing',409);
    const jobId=crypto.randomUUID();
    try{await env.DB.prepare('INSERT INTO jobs(id,owner_id,kind,resource_id) VALUES(?,?,?,?)').bind(jobId,ownerId,'finalize',s.id).run();
      await env.JOBS.send({kind:'finalize',jobId,sessionId:s.id});
    }catch(e){await env.DB.prepare("UPDATE sessions SET status='listening',ended_at=NULL WHERE id=? AND status='finalizing'").bind(s.id).run();throw e;}
    return json({status:'accepted',job_id:jobId,session_id:s.id},202);
  }
  if(method==='GET'&&(m=match(path,/^\/v1\/sessions\/([\w-]+)\/summary$/))){
    const s=await checkedSession(env,m[1],ownerId);
    const summary=await env.DB.prepare('SELECT summary_json FROM summaries WHERE session_id=?').bind(s.id).first<{summary_json:string}>();
    return json({session_id:s.id,status:s.status,summary:summary?JSON.parse(summary.summary_json):null});
  }
  if(method==='GET'&&(m=match(path,/^\/v1\/cards\/([\w-]+)\/asset$/))){
    const datasetId=requireString(url.searchParams.get('dataset_id'),'dataset_id'),d=await checkedDataset(env,datasetId,ownerId);
    const version=Number(url.searchParams.get('version'));
    if(!Number.isInteger(version)||version<1||version>d.active_version)return error('invalid_version');
    const c=await env.DB.prepare('SELECT image_key FROM cards WHERE dataset_id=? AND version=? AND card_id=?').bind(datasetId,version,m[1]).first<{image_key:string|null}>();
    if(!c?.image_key)return error('asset_not_found',404);
    const obj=await env.FILES.get(c.image_key);if(!obj)return error('asset_missing',404);
    const mime=obj.httpMetadata?.contentType||'application/octet-stream';
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))return error('invalid_media_type',415);
    return new Response(obj.body,{headers:{'Content-Type':mime,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}});
  }
  return error('route_not_found',404);
}

async function internalRoutes(request:Request,env:Env,url:URL):Promise<Response>{
  const p=url.pathname;
  let m:RegExpMatchArray|null;
  if(request.method==='GET'&&(m=p.match(/^\/internal\/files\/([\w-]+)$/))){
    const f=await env.DB.prepare('SELECT r2_key,mime_type FROM files WHERE id=?').bind(m[1]).first<{r2_key:string;mime_type:string}>();
    if(!f)return error('file_not_found',404);
    const object=await env.FILES.get(f.r2_key);if(!object)return error('file_missing',404);
    return new Response(object.body,{headers:{'Content-Type':f.mime_type,'X-Content-Type-Options':'nosniff'}});
  }
  if(request.method==='POST'&&(m=p.match(/^\/internal\/assets\/([\w-]+)$/))){
    const f=await env.DB.prepare('SELECT dataset_id FROM files WHERE id=?').bind(m[1]).first<{dataset_id:string}>();
    if(!f)return error('file_not_found',404);
    if(!request.body)return error('body_required');
    const mime=request.headers.get('content-type');
    if(!['image/png','image/jpeg','image/webp'].includes(mime||''))return error('unsupported_image_type',415);
    const key=`processed/${f.dataset_id}/${m[1]}/${crypto.randomUUID()}`;
    await env.FILES.put(key,request.body,{httpMetadata:{contentType:mime!}});
    return json({image_key:key},201);
  }
  if(request.method==='POST'&&p==='/internal/knowledge/search'){
    const x=await parseJson(request);
    const datasetId=requireString(x.dataset_id,'dataset_id'),version=Number(x.version),query=requireString(x.query,'query',2500);
    if(!Number.isInteger(version)||version<1)return error('invalid_version');
    return json({candidates:await search(env,datasetId,version,query)});
  }
  return error('route_not_found',404);
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url),path=url.pathname;
    if(path==='/health')return json({ok:true,service:'eevee',mode:env.USE_MOCK_AI==='true'?'mock':'live'});
    try{
      if(path.startsWith('/internal/')){
        if(!authorized(request,env.INTERNAL_SERVICE_TOKEN))return error('unauthorized',401);
        return await internalRoutes(request,env,url);
      }
      const websocket=path.match(/^\/v1\/sessions\/([\w-]+)\/stream$/);
      if(websocket){
        const id=websocket[1],token=url.searchParams.get('token')||'';
        if(!(await checkStreamToken(env.STREAM_SIGNING_KEY,token,id)))return error('invalid_stream_token',401);
        if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('websocket_required',426);
        const s=await env.DB.prepare('SELECT status FROM sessions WHERE id=?').bind(id).first<{status:string}>();
        if(s?.status!=='listening')return error('session_not_listening',409);
        const stub=env.SESSIONS.get(env.SESSIONS.idFromName(id));
        const headers=new Headers(request.headers);headers.set('X-Eevee-Session',id);
        const forwarded=new Request(request.url,{method:'GET',headers});
        return stub.fetch(forwarded);
      }
      if(!authorized(request,env.APP_API_KEY))return error('unauthorized',401);
      return await appRoutes(request,env,url);
    }catch(e){
      const message=e instanceof Error?e.message:'unexpected_error';
      if(message.startsWith('invalid_')||message==='no_pending_files')return error(message,400);
      if(message==='dataset_not_found'||message==='session_not_found')return error(message,404);
      console.error('request_failed',message);
      return error('internal_error',500);
    }
  },
  async queue(batch:MessageBatch<Job>,env:Env):Promise<void>{
    for(const message of batch.messages){
      try{await processJob(env,message.body);message.ack();}
      catch(e){console.error('queue_job_failed',message.body.kind,e);
        const finalAttempt=message.attempts>=4;
        await env.DB.prepare("UPDATE jobs SET status=?,error=?,updated_at=datetime('now') WHERE id=?")
          .bind(finalAttempt?'failed':'queued',String(e).slice(0,300),message.body.jobId).run();
        if(finalAttempt&&message.body.kind==='ingest') {
          await env.DB.prepare("UPDATE datasets SET status='failed',processing_version=NULL WHERE id=? AND processing_version=?")
            .bind(message.body.datasetId,message.body.version).run();
        }
        if(finalAttempt&&message.body.kind==='finalize') {
          await env.DB.prepare("UPDATE sessions SET status='failed' WHERE id=? AND status='finalizing'")
            .bind(message.body.sessionId).run();
        }
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, Job>;
