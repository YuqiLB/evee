import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workerDir, readVars, isPlaceholder} from './config.mjs';
const values = readVars();
const keys = ['APP_API_KEY', 'STREAM_SIGNING_KEY', 'MARITIME_SERVICE_TOKEN', 'INTERNAL_SERVICE_TOKEN',
  'ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID'];
const secrets = {};
for (const key of keys) {
  if (isPlaceholder(values[key])) throw new Error(`${key} is missing. Run npm run setup:local and configure ElevenLabs.`);
  secrets[key] = values[key];
}
// Keep credentials out of command arguments, files, stdout, and shell history.
const result = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', workerDir)),
  'secret', 'bulk'], {cwd: workerDir, input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit']});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
