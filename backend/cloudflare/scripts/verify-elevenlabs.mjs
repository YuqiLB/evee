import {readVars, isPlaceholder} from './config.mjs';
const values = readVars();
if (isPlaceholder(values.ELEVENLABS_API_KEY) || isPlaceholder(values.ELEVENLABS_AGENT_ID)) {
  throw new Error('Configure ElevenLabs in .dev.vars first.');
}
const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
url.searchParams.set('agent_id', values.ELEVENLABS_AGENT_ID);
try {
  const response = await fetch(url, {
    headers: {'xi-api-key': values.ELEVENLABS_API_KEY}, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}. Check key permissions and agent ownership.`);
  const result = await response.json();
  if (typeof result.signed_url !== 'string' || !result.signed_url.startsWith('wss://api.elevenlabs.io/')) {
    throw new Error('ElevenLabs did not return a valid signed connection URL.');
  }
  console.log('ElevenLabs credentials and agent verified. Signed URL received; not printed.');
} catch (error) {
  console.error(error.message);
  if (error.cause?.code) console.error(`Network: ${error.cause.code}`);
  process.exitCode = 1;
}
