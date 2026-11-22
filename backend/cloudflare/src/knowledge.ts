import type {Env,Candidate,Card} from './types';
export function ftsQuery(text:string){const stop=new Set(['a','an','the','and','or','but','if','of','for','on','to','in','is','at','we','it','you','our','that','with','this','about','from','are','was','will','have','has','can','what','when','which','could','would','should','lets','they','them','were']);const tokens=[...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(w=>!stop.has(w)))].slice(-14);return tokens.map(t=>`"${t}"`).join(' OR ');}
export async function search(env:Env,datasetId:string,version:number,text:string,limit=15):Promise<Candidate[]>{
  const query=ftsQuery(text);
  if(!query)return [];
  const rows=await env.DB.prepare(`SELECT c.card_id,c.type,c.title,c.body,c.hints_json,c.keywords_json
    FROM cards_fts JOIN cards AS c ON c.card_id=cards_fts.card_id AND c.dataset_id=cards_fts.dataset_id AND c.version=cards_fts.version
    WHERE cards_fts.dataset_id=? AND cards_fts.version=? AND cards_fts MATCH ? ORDER BY bm25(cards_fts) LIMIT ?`)
    .bind(datasetId,String(version),query,limit).all();
  return rows.results.map((r:any)=>({id:String(r.card_id),type:r.type,title:r.title,body:r.body,hints:JSON.parse(r.hints_json),keywords:JSON.parse(r.keywords_json)}));
}
export function validateCards(response:unknown,fileId:string,mediaKeys:string[]):Omit<Card,'card_id'>[]{
  if(!response||typeof response!=='object'||!Array.isArray((response as any).cards))throw new Error('invalid_ingestion_response');
  return (response as any).cards.slice(0,75).map((raw:any)=>{
    if(!raw||!['text','image','text_image'].includes(raw.type)||typeof raw.title!=='string'||raw.title.length>180)throw new Error('invalid_card');
    const body=typeof raw.body==='string'?raw.body.slice(0,6000):null;
    const imageKey=Number.isInteger(raw.asset_ref)&&raw.asset_ref>=0&&raw.asset_ref<mediaKeys.length?mediaKeys[raw.asset_ref]:null;
    if(raw.type==='text'&&!body)throw new Error('missing_text');
    if(raw.type==='image'&&!imageKey)throw new Error('missing_image');
    if(raw.type==='text_image'&&(!body||!imageKey))throw new Error('missing_text_or_image');
    const hints=(Array.isArray(raw.hints)?raw.hints:[]).filter((x:unknown)=>typeof x==='string').slice(0,12).map((s:string)=>s.slice(0,180));
    const keywords=(Array.isArray(raw.keywords)?raw.keywords:[]).filter((x:unknown)=>typeof x==='string').slice(0,20).map((s:string)=>s.slice(0,80));
    return {type:raw.type,title:raw.title,body,image_key:imageKey,hints,keywords,source_file_id:fileId,source_page:Number.isInteger(raw.source_page)&&raw.source_page>0?raw.source_page:null};
  });
}
export async function insertCards(env:Env,datasetId:string,version:number,cards:Omit<Card,'card_id'>[]){
  for(const c of cards){
    const id=crypto.randomUUID();const searchText=[c.title,c.body||'',...c.hints,...c.keywords].join(' ');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO cards(card_id,dataset_id,version,type,title,body,image_key,hints_json,keywords_json,search_text,source_file_id,source_page) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,datasetId,version,c.type,c.title,c.body,c.image_key,JSON.stringify(c.hints),JSON.stringify(c.keywords),searchText,c.source_file_id,c.source_page),
      env.DB.prepare(`INSERT INTO cards_fts(dataset_id,version,card_id,search_text) VALUES(?,?,?,?)`).bind(datasetId,String(version),id,searchText)
    ]);
  }
}
export async function hydrate(env:Env,datasetId:string,version:number,ids:string[]){
  const result=[];
  for(const id of ids.slice(0,6)){
    const c=await env.DB.prepare('SELECT * FROM cards WHERE dataset_id=? AND version=? AND card_id=?').bind(datasetId,version,id).first<any>();
    if(!c)continue;
    result.push({id:c.card_id,type:c.type,title:c.title,text:c.body,
      image:c.image_key?{path:`/v1/cards/${encodeURIComponent(id)}/asset?dataset_id=${encodeURIComponent(datasetId)}&version=${version}`} :null,
      source:{file_id:c.source_file_id,page:c.source_page}});
  }
  return result;
}
