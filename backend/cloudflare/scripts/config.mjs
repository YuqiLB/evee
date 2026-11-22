import {readFileSync, writeFileSync} from 'node:fs';
export const workerDir = new URL('../', import.meta.url);
export const varsFile = new URL('.dev.vars', workerDir);
export function readVars() {
  const result = {};
  for (const line of readFileSync(varsFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return result;
}
export function writeVars(values) {
  writeFileSync(varsFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')+'\n', {mode: 0o600});
}
export function isPlaceholder(value) {
  return !value || /replace|dummy|example|mock|your-/i.test(value);
}
