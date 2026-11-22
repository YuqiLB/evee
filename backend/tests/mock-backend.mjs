import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

// Run actual application code without starting a server. This shim provides
// only the Durable Object base class; storage and sockets are explicit fakes.
const sourceRoot = new URL('../cloudflare/src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
        'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'
      )};
    }
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const {default: worker, SessionHub} = await import('../cloudflare/src/index.ts');
const migration = readFileSync(new URL('../cloudflare/migrations/0001_initial.sql', import.meta.url), 'utf8');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(migration);
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return {results: sqlite.prepare(this.sql).all(...this.values)}; }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return {success: true, meta: {changes: Number(result.changes)}};
    }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  const objects = new Map();
  const pending = [];
  const env = {
    DB,
    FILES: {
      async put(key, body, metadata) {
        const bytes = await new Response(body).arrayBuffer();
        objects.set(key, {bytes, ...metadata});
        return {size: bytes.byteLength};
      },
      async get(key) {
        const object = objects.get(key);
        return object ? {...object, body: new Response(object.bytes).body} : null;
      },
      async delete(key) { objects.delete(key); }
    },
    JOBS: {async send(job) { pending.push(job); }},
    APP_API_KEY: 'local-test-app-key',
    INTERNAL_SERVICE_TOKEN: 'local-test-internal-key',
    STREAM_SIGNING_KEY: 'local-test-stream-signing-key',
    USE_MOCK_AI: 'true',
    API_ORIGIN: 'https://eevee.test',
    MARITIME_ORIGIN: 'https://unused.test',
    ELEVENLABS_API_KEY: 'local-test-elevenlabs-key',
    ELEVENLABS_AGENT_ID: 'agent-test'
  };
  async function request(path, {method = 'GET', json, body, headers = {}, authenticated = true} = {}) {
    const h = new Headers(headers);
    if (authenticated) h.set('Authorization', `Bearer ${env.APP_API_KEY}`);
    if (json !== undefined) { body = JSON.stringify(json); h.set('Content-Type', 'application/json'); }
    if (body !== undefined) h.set('Content-Length', String(Buffer.byteLength(body)));
    return worker.fetch(new Request(`https://eevee.test${path}`, {method, headers: h, body}), env);
  }
  async function drain() {
    while (pending.length) {
      let acknowledged = false;
      let retried = false;
      const message = {body: pending.shift(), attempts: 1,
        ack() { acknowledged = true; }, retry() { retried = true; }};
      await worker.queue({messages: [message]}, env);
      assert.equal(retried, false, 'Queue job should succeed on its first attempt');
      assert.equal(acknowledged, true);
    }
  }
  async function upload(datasetId, filename = 'demo.txt') {
    const response = await request(`/v1/datasets/${datasetId}/files`, {
      method: 'POST', body: 'Sample research notes for the demo.',
      headers: {'Content-Type': 'text/plain', 'X-Filename': filename}
    });
    assert.equal(response.status, 201);
    return response.json();
  }
  async function process(datasetId) {
    const response = await request(`/v1/datasets/${datasetId}/process`, {method: 'POST'});
    assert.equal(response.status, 202);
    const job = await response.json();
    await drain();
    assert.equal((await (await request(`/v1/jobs/${job.job_id}`)).json()).status, 'completed');
    return job;
  }
  async function readyDataset() {
    const response = await request('/v1/datasets', {method: 'POST', json: {name: 'Demo research'}});
    assert.equal(response.status, 201);
    const {dataset_id} = await response.json();
    const file = await upload(dataset_id);
    await process(dataset_id);
    return {datasetId: dataset_id, file};
  }
  async function session(datasetId) {
    const response = await request('/v1/sessions', {method: 'POST', json: {dataset_id: datasetId}});
    assert.equal(response.status, 201);
    return response.json();
  }
  return {sqlite, env, request, drain, upload, process, readyDataset, session};
}

test('health, API authorization, and invalid stream tokens', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  assert.deepEqual(await (await f.request('/health', {authenticated: false})).json(),
    {ok: true, service: 'eevee', mode: 'mock'});
  assert.equal((await f.request('/v1/datasets', {method: 'POST', authenticated: false})).status, 401);
  assert.equal((await f.request('/v1/sessions/missing/stream?token=invalid', {authenticated: false})).status, 401);
});

test('asynchronous route validation returns structured errors', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const missing = await f.request('/v1/datasets/missing');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'dataset_not_found');
  const invalid = await f.request('/v1/datasets', {method: 'POST', json: {name: ''}});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'invalid_name');
  const internal = await f.request('/internal/knowledge/search', {method: 'POST', json: {},
    authenticated: false, headers: {Authorization: `Bearer ${f.env.INTERNAL_SERVICE_TOKEN}`}});
  assert.equal(internal.status, 400);
});

test('uploads, ingestion queue, FTS retrieval, transcripts, and summaries', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const {datasetId, file} = await f.readyDataset();
  const original = await f.request(`/internal/files/${file.file_id}`, {authenticated: false,
    headers: {Authorization: `Bearer ${f.env.INTERNAL_SERVICE_TOKEN}`}});
  assert.equal(await original.text(), 'Sample research notes for the demo.');
  const session = await f.session(datasetId);
  const sessionId = session.session_id;
  const token = await (await f.request(`/v1/sessions/${sessionId}/stream-token`, {method: 'POST'})).json();
  assert.equal((await f.request(token.path, {authenticated: false})).status, 426);
  assert.equal((await f.request(token.path.replace(sessionId, 'different-session'), {authenticated: false})).status, 401);

  const events = [];
  const socket = {deserializeAttachment: () => ({session_id: sessionId}),
    send: data => events.push(JSON.parse(data))};
  const stored = new Map();
  const ctx = {getWebSockets: () => [socket], storage: {
    async get(key) { return stored.get(key); }, async put(key, value) { stored.set(key, value); }
  }};
  const hub = new SessionHub(ctx, f.env);
  const text = 'Tell me about this sample demo.';
  const committed = {v: 1, event_id: randomUUID(), type: 'transcript.committed',
    session_id: sessionId, seq: 1, payload: {segment_id: 'segment-1', text}};
  await hub.webSocketMessage(socket, JSON.stringify(committed));
  const update = events.find(event => event.type === 'context.update');
  assert.ok(update, 'FTS and mock context selection should emit a card');
  assert.equal(update.payload.items.length, 1);
  assert.equal(update.payload.items[0].title, 'Demo: demo.txt');
  await hub.webSocketMessage(socket, JSON.stringify(committed));
  assert.equal(events.at(-1).type, 'event.ignored');
  await hub.webSocketMessage(socket, JSON.stringify({...committed, event_id: randomUUID(), seq: 2,
    type: 'transcript.partial', payload: {segment_id: 'segment-2', text: 'More sample demo details.'}}));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM transcript_segments').get().n, 1);
  await hub.webSocketMessage(socket, JSON.stringify({...committed, event_id: randomUUID(), seq: 3,
    payload: {segment_id: 'segment-2', text: 'Goodbye, that is all.'}}));
  assert.ok(events.some(event => event.type === 'conversation.end_candidate'));

  // Appending builds a new version without changing an existing session's cards.
  await f.upload(datasetId, 'second.txt');
  await f.process(datasetId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE version=1').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE version=2').get().n, 2);
  assert.equal((await f.session(datasetId)).dataset_version, 2);
  assert.equal(session.dataset_version, 1);

  const end = await f.request(`/v1/sessions/${sessionId}/end`, {method: 'POST', json: {email: null}});
  assert.equal(end.status, 202);
  await f.drain();
  const summary = await (await f.request(`/v1/sessions/${sessionId}/summary`)).json();
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.summary.key_points, [text, 'Goodbye, that is all.']);
  assert.equal('emails' in summary, false);
  assert.equal((await f.request(`/v1/sessions/${sessionId}/end`, {method: 'POST', json: {email: null}})).status, 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM summaries').get().n, 1);
});

test('finalization ignores legacy email input and never sends email', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const {datasetId} = await f.readyDataset();
  const {session_id: sessionId} = await f.session(datasetId);
  const response = await f.request(`/v1/sessions/${sessionId}/end`, {
    method: 'POST', json: {email: 'owner@example.test'}
  });
  const {job_id: jobId} = await response.json();
  await f.drain();
  const job = await (await f.request(`/v1/jobs/${jobId}`)).json();
  assert.equal(job.result.summary_saved, true);
  assert.equal('email_status' in job.result, false);
  const summary = await (await f.request(`/v1/sessions/${sessionId}/summary`)).json();
  assert.equal('emails' in summary, false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM email_deliveries').get().n, 0);
});

test('ElevenLabs signed URLs require app authentication and keep the API key server-side', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.elevenlabs.io');
    assert.equal(url.searchParams.get('agent_id'), 'agent-test');
    assert.equal(options.headers['xi-api-key'], f.env.ELEVENLABS_API_KEY);
    return Response.json({signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?token=test'});
  };
  assert.equal((await f.request('/v1/elevenlabs/signed-url', {method: 'POST', authenticated: false})).status, 401);
  assert.equal(calls, 0);
  const response = await f.request('/v1/elevenlabs/signed-url', {method: 'POST'});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const text = await response.text();
  assert.equal(text.includes(f.env.ELEVENLABS_API_KEY), false);
  assert.ok(JSON.parse(text).signed_url.startsWith('wss://api.elevenlabs.io/'));

  const {datasetId} = await f.readyDataset();
  const {session_id: sessionId} = await f.session(datasetId);
  const connection = await f.request(`/v1/sessions/${sessionId}/elevenlabs`, {method: 'POST'});
  assert.equal((await connection.json()).session_id, sessionId);
  await f.request(`/v1/sessions/${sessionId}/end`, {method: 'POST'});
  assert.equal((await f.request(`/v1/sessions/${sessionId}/elevenlabs`, {method: 'POST'})).status, 409);
});

test('ElevenLabs configuration and upstream failures return safe errors', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  f.env.ELEVENLABS_API_KEY = '';
  assert.equal((await f.request('/v1/elevenlabs/signed-url', {method: 'POST'})).status, 503);
  f.env.ELEVENLABS_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response('provider-internal-details', {status: 401});
  const denied = await f.request('/v1/elevenlabs/signed-url', {method: 'POST'});
  assert.equal(denied.status, 502);
  assert.equal((await denied.text()).includes('provider-internal-details'), false);
  globalThis.fetch = async () => { throw new Error('network disconnected'); };
  assert.equal((await f.request('/v1/elevenlabs/signed-url', {method: 'POST'})).status, 502);
  globalThis.fetch = async () => Response.json({signed_url: 'https://unexpected.test/'});
  assert.equal((await f.request('/v1/elevenlabs/signed-url', {method: 'POST'})).status, 502);
});
