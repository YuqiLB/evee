import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElevenLabsAdapter} from '../integrations/elevenlabs-adapter.mjs';

test('native transcripts deduplicate by provider event ID and resume after reconnect', () => {
  const sent = [];
  const adapter = createElevenLabsAdapter({sessionId: 'session-1', send: text => sent.push(JSON.parse(text))});
  adapter.onEeveeMessage({type: 'session.connected', session_id: 'session-1', payload: {next_seq: 8}});
  const native = {type: 'user_transcript', user_transcription_event: {event_id: 12, user_transcript: 'How much does it cost?'}};
  adapter.onNativeEvent(native);
  adapter.onNativeEvent(native);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].seq, 8);
  assert.equal(sent[0].type, 'transcript.committed');
  adapter.onEeveeMessage({type: 'session.connected', session_id: 'session-1', payload: {next_seq: 20}});
  adapter.onSdkMessage({source: 'user', message: 'What about support?'});
  assert.equal(sent[1].seq, 20);
  assert.equal(adapter.onNativeEvent({type: 'ping'}), null);
  assert.equal(adapter.onSdkMessage({source: 'ai', message: 'An agent answer.'}), null);
  assert.equal(sent.length, 2);
});
