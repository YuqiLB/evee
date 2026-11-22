import type {Env} from './types';
import {error,json} from './utils';

// Only the trusted app backend calls this route. The browser receives the
// temporary signed URL, never either service's API key.
export async function elevenLabsConnection(env:Env,sessionId?:string):Promise<Response>{
  if(!env.ELEVENLABS_API_KEY||!env.ELEVENLABS_AGENT_ID){
    return error('elevenlabs_not_configured',503);
  }
  const url=new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
  url.searchParams.set('agent_id',env.ELEVENLABS_AGENT_ID);
  let response:Response;
  try{
    response=await fetch(url,{
      headers:{'xi-api-key':env.ELEVENLABS_API_KEY},
      signal:AbortSignal.timeout(10000)
    });
  }catch{
    return error('elevenlabs_unreachable',502);
  }
  if(!response.ok){
    // Provider bodies can contain request details. Return status, not raw text.
    return error('elevenlabs_request_failed',502,`ElevenLabs returned HTTP ${response.status}`);
  }
  let data:{signed_url?:unknown};
  try{data=await response.json();}catch{return error('elevenlabs_invalid_response',502);}
  if(!data||typeof data.signed_url!=='string')return error('elevenlabs_invalid_response',502);
  try{
    const signed=new URL(data.signed_url);
    if(signed.protocol!=='wss:'||signed.hostname!=='api.elevenlabs.io')throw new Error();
  }catch{return error('elevenlabs_invalid_response',502);}
  return json({agent_id:env.ELEVENLABS_AGENT_ID,signed_url:data.signed_url,...(sessionId?{session_id:sessionId}:{})});
}
