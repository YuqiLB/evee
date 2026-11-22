import {readFileSync, writeFileSync} from 'node:fs';
import {workerDir, readVars, writeVars} from './config.mjs';
const value = process.argv[2];
if (!value) throw new Error('Usage: npm run connect:maritime -- https://YOUR_AGENT_ID.mtm.sh');
const origin = new URL(value);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('Supply the public HTTPS origin of your Maritime agent.');
}
const vars = readVars();
if (!vars.MARITIME_SERVICE_TOKEN) throw new Error('Run npm run setup:local first.');
// Check service configuration before switching ingestion and summaries live.
const response = await fetch(`${origin.origin}/v1/ready`, {
  headers: {Authorization: `Bearer ${vars.MARITIME_SERVICE_TOKEN}`}, signal: AbortSignal.timeout(120000)
});
if (!response.ok) throw new Error(`Maritime readiness check failed: HTTP ${response.status}. Check Env and public URL visibility.`);
const readiness = await response.json();
if (!readiness.ready) throw new Error(`Maritime is missing: ${(readiness.missing || []).join(', ')}`);
const configFile = new URL('wrangler.jsonc', workerDir);
let config = readFileSync(configFile, 'utf8');
config = config.replace(/("MARITIME_ORIGIN"\s*:\s*)"[^"]*"/, (_, prefix) => prefix+JSON.stringify(origin.origin))
  .replace(/("USE_MOCK_AI"\s*:\s*)"[^"]*"/, '$1"false"');
writeFileSync(configFile, config);
vars.MARITIME_ORIGIN = origin.origin;
vars.USE_MOCK_AI = 'false';
writeVars(vars);
console.log('Maritime is configured and live mode is enabled locally. Run npm run deploy to apply it to Cloudflare.');
