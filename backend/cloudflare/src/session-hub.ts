import {DurableObject} from 'cloudflare:workers';
import type {Env,Transcript,Candidate} from './types';
import {callMaritime} from './utils';
import {hydrate,search} from './knowledge';

type ModelResult={selected_card_ids:string[];end_candidate:boolean;end_confidence:number};
const isText=(v:unknown):v is string=>typeof v==='string';
function transcriptEvent(x:unknown,sessionId:string):x is Transcript{
  if(!x||typeof x!=='object')return false;
  const y=x as any;
  return y.v===1&&y.session_id===sessionId&&
    ['transcript.partial','transcript.committed'].includes(y.type)&&
    typeof y.event_id==='string'&&y.event_id.length<=128&&
    Number.isSafeInteger(y.seq)&&y.seq>=0&&
    typeof y.payload==='object'&&y.payload!==null&&
    typeof y.payload.segment_id==='string'&&y.payload.segment_id.length<=128&&
    isText(y.payload.text)&&y.payload.text.length<=6000;
}

export class SessionHub extends DurableObject<Env>{
  async fetch(request:Request):Promise<Response>{
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('upgrade required',{status:426});
    const sessionId=request.headers.get('X-Eevee-Session');
    if(!sessionId)return new Response('missing session',{status:400});
    const pair=new WebSocketPair();const client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({session_id:sessionId});
    const nextSeq=((await this.ctx.storage.get<number>('max_seq'))??-1)+1;
    server.send(JSON.stringify({v:1,type:'session.connected',session_id:sessionId,payload:{ready:true,next_seq:nextSeq}}));
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(socket:WebSocket,data:string|ArrayBuffer){
    const attach=socket.deserializeAttachment() as {session_id?:string}|null;
    const sessionId=attach?.session_id;
    if(!sessionId)return;
    let ev:unknown;
    try{ev=JSON.parse(typeof data==='string'?data:new TextDecoder().decode(data));}
    catch{socket.send(JSON.stringify({type:'error',payload:{code:'bad_json'}}));return;}
    if(!transcriptEvent(ev,sessionId)){
      socket.send(JSON.stringify({type:'error',payload:{code:'invalid_event'}}));return;
    }
    const event=ev;
    const maxRev=(await this.ctx.storage.get<number>('max_seq'))??-1;
    if(event.seq<=maxRev){socket.send(JSON.stringify({type:'event.ignored',payload:{reason:'old_sequence',seq:event.seq}}));return;}
    await this.ctx.storage.put('max_seq',event.seq);
    // Persist committed segments only. A partial segment may be revised.
    if(event.type==='transcript.committed'){
      await this.env.DB.prepare(`INSERT INTO transcript_segments
        (session_id,segment_id,seq,speaker_id,text,start_ms,end_ms) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(session_id,segment_id) DO UPDATE SET
          seq=excluded.seq, speaker_id=excluded.speaker_id, text=excluded.text,
          start_ms=excluded.start_ms,end_ms=excluded.end_ms`)
        .bind(sessionId,event.payload.segment_id,event.seq,event.payload.speaker_id??null,
          event.payload.text,event.payload.start_ms??null,event.payload.end_ms??null).run();
    }
    // Speculative partial processing at most once every 900 ms; committed always handled.
    const now=Date.now();const last=(await this.ctx.storage.get<number>('last_partial_at'))??0;
    if(event.type==='transcript.partial'){
      if(event.payload.text.length<15||now-last<900)return;
      await this.ctx.storage.put('last_partial_at',now);
    }
    try{await this.interpret(socket,sessionId,event);}catch(e){
      console.error('context_update_failed',e);
      socket.send(JSON.stringify({v:1,type:'context.error',session_id:sessionId,payload:{code:'context_unavailable'}}));
    }
  }
  private async interpret(socket:WebSocket,sessionId:string,ev:Transcript){
    const s=await this.env.DB.prepare('SELECT dataset_id,dataset_version,status FROM sessions WHERE id=?')
      .bind(sessionId).first<{dataset_id:string;dataset_version:number;status:string}>();
    if(s?.status!=='listening')return;
    const transcript=await this.env.DB.prepare(`SELECT text FROM transcript_segments WHERE session_id=? ORDER BY seq DESC LIMIT 8`)
      .bind(sessionId).all<{text:string}>();
    const recent=transcript.results.reverse().map(x=>x.text);
    if(ev.type==='transcript.partial')recent.push(ev.payload.text);
    if(recent.length===0)recent.push(ev.payload.text);
    const context=recent.join(' ').slice(-4500);
    const candidates=await search(this.env,s.dataset_id,s.dataset_version,context,20);
    const result=await callMaritime<ModelResult>(this.env,'/v1/context',{
      session_id:sessionId,revision:ev.seq,recent_text:ev.payload.text,
      rolling_context:context,candidates,shown_card_ids:(await this.ctx.storage.get<string[]>('shown_cards'))||[]
    },3000);
    // Ignore stale completions if a newer event was received while model ran.
    if((await this.ctx.storage.get<number>('max_seq'))!==ev.seq)return;
    const allowed=new Map(candidates.map(c=>[c.id,c]));
    const selected:string[]=[];
    let images=0;
    for(const id of Array.isArray(result.selected_card_ids)?result.selected_card_ids:[]){
      if(typeof id!=='string'||selected.includes(id)||!allowed.has(id))continue;
      const c=allowed.get(id)!;
      if(c.type!=='text'&&images>=3)continue;
      if(c.type!=='text')images++;
      selected.push(id);
      if(selected.length===6)break;
    }
    const previous=(await this.ctx.storage.get<string[]>('shown_cards'))||[];
    const newSet=JSON.stringify(previous)!==JSON.stringify(selected);
    if(newSet){
      await this.ctx.storage.put('shown_cards',selected);
      const items=await hydrate(this.env,s.dataset_id,s.dataset_version,selected);
      this.emit({v:1,event_id:crypto.randomUUID(),type:selected.length?'context.update':'context.clear',session_id:sessionId,
        payload:{revision:ev.seq,mode:'replace',items}});
    }else{
      this.emit({v:1,event_id:crypto.randomUUID(),type:'context.no_change',session_id:sessionId,payload:{revision:ev.seq}});
    }
    const prob=Number(result.end_confidence);
    if(result.end_candidate&&Number.isFinite(prob)&&prob>=0.75){
      this.emit({v:1,event_id:crypto.randomUUID(),type:'conversation.end_candidate',session_id:sessionId,
        payload:{confidence:Math.min(1,prob),reason:'model_detected_closing'}});
    }
  }
  private emit(event:unknown){
    const wire=JSON.stringify(event);
    for(const socket of this.ctx.getWebSockets()){
      try{socket.send(wire);}catch{}
    }
  }
}
