import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, chmodSync, copyFileSync} from 'node:fs';
import {workerDir, varsFile, readVars, writeVars, isPlaceholder} from './config.mjs';

if (!existsSync(varsFile)) copyFileSync(new URL('.dev.vars.example', workerDir), varsFile);
const values = readVars();
for (const key of ['APP_API_KEY', 'STREAM_SIGNING_KEY', 'MARITIME_SERVICE_TOKEN', 'INTERNAL_SERVICE_TOKEN']) {
  if (isPlaceholder(values[key])) values[key] = randomBytes(32).toString('hex');
}
delete values.RESEND_API_KEY;
delete values.RESEND_WEBHOOK_SECRET;
writeVars(values);
chmodSync(varsFile, 0o600);

const path = new URL('../../maritime/.env', import.meta.url);
const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
const maritime = {
  MARITIME_SERVICE_TOKEN: values.MARITIME_SERVICE_TOKEN,
  INTERNAL_SERVICE_TOKEN: values.INTERNAL_SERVICE_TOKEN,
  CLOUDFLARE_ORIGIN: 'https://eevee.yyznate.workers.dev',
  SMART_MODEL: 'claude-opus-5-5', FAST_MODEL: 'claude-haiku-5-5'
};
let output = existing;
for (const [key, value] of Object.entries(maritime)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  // Retain user-selected models and origins, synchronize only shared tokens.
  if (pattern.test(output) && !key.endsWith('_TOKEN')) continue;
  output = pattern.test(output) ? output.replace(pattern, () => `${key}=${value}`) : output.trimEnd()+`\n${key}=${value}\n`;
}
writeFileSync(path, output.trimStart(), {mode: 0o600});
chmodSync(path, 0o600);
console.log('Local service secrets and Maritime environment are ready. Values have not been printed.');
if (isPlaceholder(values.ELEVENLABS_API_KEY) || isPlaceholder(values.ELEVENLABS_AGENT_ID)) {
  console.log('Add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to cloudflare/.dev.vars.');
}
