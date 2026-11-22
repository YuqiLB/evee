import type {Env,Job} from './types';
import {callMaritime} from './utils';
import {insertCards,validateCards} from './knowledge';

type IngestResponse={cards:unknown[];asset_keys?:string[]};
type Summary={title:string;overview:string;key_points:string[];decisions:string[];action_items:Array<{task:string;owner:string|null}>;open_questions:string[];source_card_ids:string[]};

export async function processJob(env:Env,job:Job){
  const j=await env.DB.prepare('SELECT status FROM jobs WHERE id=?').bind(job.jobId).first<{status:string}>();
  if(j?.status==='completed')return;
  await env.DB.prepare("UPDATE jobs SET status='running',error=NULL,updated_at=datetime('now') WHERE id=?").bind(job.jobId).run();
  if(job.kind==='ingest')await ingest(env,job);
  else await finalize(env,job);
}
async function ingest(env:Env,job:Extract<Job,{kind:'ingest'}>){
  const dataset=await env.DB.prepare('SELECT active_version,processing_version FROM datasets WHERE id=?')
    .bind(job.datasetId).first<{active_version:number;processing_version:number|null}>();
  if(!dataset||dataset.processing_version!==job.version)throw new Error('ingest_version_mismatch');
  const files=await env.DB.prepare('SELECT * FROM files WHERE dataset_id=? AND version_added=?')
    .bind(job.datasetId,job.version).all<any>();
  // Rebuild this inactive version from scratch on retry. Active version is untouched.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cards_fts WHERE dataset_id=? AND version=?').bind(job.datasetId,String(job.version)),
    env.DB.prepare('DELETE FROM cards WHERE dataset_id=? AND version=?').bind(job.datasetId,job.version)
  ]);
  if(dataset.active_version>0){
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO cards(card_id,dataset_id,version,type,title,body,image_key,hints_json,keywords_json,search_text,source_file_id,source_page)
        SELECT card_id,dataset_id,?,type,title,body,image_key,hints_json,keywords_json,search_text,source_file_id,source_page
        FROM cards WHERE dataset_id=? AND version=?`)
        .bind(job.version,job.datasetId,dataset.active_version),
      env.DB.prepare(`INSERT INTO cards_fts(dataset_id,version,card_id,search_text)
        SELECT dataset_id,?,card_id,search_text FROM cards_fts WHERE dataset_id=? AND version=?`)
        .bind(String(job.version),job.datasetId,String(dataset.active_version))
    ]);
  }
  let inserted=0;
  for(const f of files.results){
    const response=await callMaritime<IngestResponse>(env,'/v1/ingest',{
      dataset_id:job.datasetId,version:job.version,file_id:f.id,
      filename:f.filename,mime_type:f.mime_type,r2_key:f.r2_key,
      cloudflare_origin:env.API_ORIGIN
    },120000);
    // Enforce ownership of media, even if the AI output is malformed.
    const assets=(response.asset_keys||[]).map(key=>typeof key==='string'&&
      (key===f.r2_key||key.startsWith(`processed/${job.datasetId}/${f.id}/`))?key:'');
    const cards=validateCards(response,f.id,assets);
    await insertCards(env,job.datasetId,job.version,cards);
    inserted+=cards.length;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE datasets SET active_version=?,processing_version=NULL,status='ready' WHERE id=? AND processing_version=?")
      .bind(job.version,job.datasetId,job.version),
    env.DB.prepare("UPDATE jobs SET status='completed',result_json=?,updated_at=datetime('now') WHERE id=?")
      .bind(JSON.stringify({event:'dataset.ready',dataset_id:job.datasetId,version:job.version,cards_added:inserted}),job.jobId)
  ]);
}
async function finalize(env:Env,job:Extract<Job,{kind:'finalize'}>){
  const session=await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(job.sessionId).first<any>();
  if(!session)throw new Error('session_not_found');
  const rows=await env.DB.prepare('SELECT segment_id,seq,speaker_id,text,start_ms,end_ms FROM transcript_segments WHERE session_id=? ORDER BY seq')
    .bind(job.sessionId).all();
  let summaryRec=await env.DB.prepare('SELECT summary_json FROM summaries WHERE session_id=?')
    .bind(job.sessionId).first<{summary_json:string}>();
  let summary:Summary;
  if(summaryRec){summary=JSON.parse(summaryRec.summary_json);}
  else{
    const source=await env.DB.prepare('SELECT card_id,title,body FROM cards WHERE dataset_id=? AND version=? LIMIT 60')
      .bind(session.dataset_id,session.dataset_version).all();
    const response=await callMaritime<Summary>(env,'/v1/summarize',{
      session_id:job.sessionId,transcript:rows.results,source_context:source.results
    },120000);
    if(!response||typeof response.title!=='string'||!Array.isArray(response.key_points))throw new Error('summary_schema_invalid');
    summary={title:response.title.slice(0,200),overview:String(response.overview||''),key_points:response.key_points,
      decisions:Array.isArray(response.decisions)?response.decisions:[],
      action_items:Array.isArray(response.action_items)?response.action_items:[],
      open_questions:Array.isArray(response.open_questions)?response.open_questions:[],
      source_card_ids:Array.isArray(response.source_card_ids)?response.source_card_ids:[]};
    await env.DB.prepare('INSERT OR IGNORE INTO summaries(session_id,summary_json) VALUES(?,?)')
      .bind(job.sessionId,JSON.stringify(summary)).run();
  }
  await env.DB.prepare("UPDATE sessions SET status='completed' WHERE id=?").bind(job.sessionId).run();
  await env.DB.prepare("UPDATE jobs SET status='completed',result_json=?,updated_at=datetime('now') WHERE id=?")
    .bind(JSON.stringify({event:'conversation.completed',session_id:job.sessionId,summary_saved:true}),job.jobId).run();
}
