import type { Env } from './types';
export const json = (v:unknown, status=200) => Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export const error = (code:string,status=400,message=code)=>json({error:{code,message}},status);
export function authorized(request:Request,secret:string) {
  // Do not use this bearer token in public browser code. App backend only.
  return Boolean(secret && request.headers.get('Authorization')===`Bearer ${secret}`);
}
export function owner(request:Request) {
  // Single trusted application / tenant MVP. Replace with validated user JWT subject.
  return 'app-tenant';
}
export function requireString(v:unknown, field:string,max=500):string {
  if(typeof v!=='string'||!v.trim()||v.length>max) throw new Error(`invalid_${field}`);
  return v.trim();
}
export async function parseJson(request:Request):Promise<Record<string,unknown>>{
  const value:unknown=await request.json();
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_json_body');
  return value as Record<string,unknown>;
}
export async function callMaritime<T>(env:Env,path:string,payload:unknown, timeout=60000):Promise<T>{
  if(env.USE_MOCK_AI==='true')return mockMaritime<T>(path,payload);
  if(!env.MARITIME_ORIGIN.startsWith('https://'))throw new Error('maritime_origin_missing');
  const r=await fetch(`${env.MARITIME_ORIGIN.replace(/\/$/,'')}${path}`,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.MARITIME_SERVICE_TOKEN}`},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)
  });
  if(!r.ok)throw new Error(`maritime_http_${r.status}: ${ (await r.text()).slice(0,300)}`);
  return r.json() as Promise<T>;
}
async function mockMaritime<T>(path:string,payload:unknown):Promise<T>{
  const x=payload as Record<string,any>;
  if(path==='/v1/ingest')return {
    cards:[{type:'text',title:`Demo: ${x.filename}`,body:'A sample card produced by MOCK mode; replace with real Maritime extraction.',asset_ref:null,hints:['demo','sample','test'],keywords:['demo','sample'],source_page:null}]
  } as T;
  if(path==='/v1/context'){
    const query=String(x.recent_text??'').toLowerCase();
    const candidates=Array.isArray(x.candidates)?x.candidates:[];
    const matching=candidates.filter((v:any)=>`${v.title} ${v.body||''} ${v.hints?.join(' ')||''}`.toLowerCase().split(/\W+/).some((word:string)=>word.length>3&&query.includes(word))).slice(0,6);
    return {selected_card_ids:matching.map((v:any)=>v.id),end_candidate:/\b(goodbye|meeting adjourned|that is all)\b/i.test(query),end_confidence:0.94} as T;
  }
  if(path==='/v1/summarize')return {title:'Demo conversation summary',overview:'Mock summary: replace with smart AI.',key_points:(x.transcript||[]).slice(0,6).map((z:any)=>z.text),decisions:[],action_items:[],open_questions:[],source_card_ids:[]} as T;
  throw new Error('unknown_mock_route');
}
const enc=new TextEncoder();
function b64u(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function un64(s:string){const fixed=s.replace(/-/g,'+').replace(/_/g,'/');const str=atob(fixed.padEnd(Math.ceil(fixed.length/4)*4,'='));return Uint8Array.from(str,c=>c.charCodeAt(0));}
async function sign(key:string,value:string){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(value))));}
export async function streamToken(key:string,sessionId:string){const p=b64u(enc.encode(JSON.stringify({sid:sessionId,exp:Date.now()+60000})));return `${p}.${await sign(key,p)}`;}
export async function checkStreamToken(key:string,token:string,sessionId:string){try{const [p,s]=token.split('.');if(!p||!s)return false;const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!(await crypto.subtle.verify('HMAC',k,un64(s),enc.encode(p))))return false;const data=JSON.parse(new TextDecoder().decode(un64(p)));return data.sid===sessionId&&typeof data.exp==='number'&&Date.now()<data.exp;}catch{return false;}}
