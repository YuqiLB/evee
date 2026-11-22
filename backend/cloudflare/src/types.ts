export type Job =
  | { kind: 'ingest'; jobId: string; datasetId: string; version: number }
  | { kind: 'finalize'; jobId: string; sessionId: string };
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  JOBS: Queue<Job>;
  SESSIONS: DurableObjectNamespace;
  MARITIME_ORIGIN: string;
  MARITIME_SERVICE_TOKEN: string;
  INTERNAL_SERVICE_TOKEN: string;
  APP_API_KEY: string;
  STREAM_SIGNING_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_AGENT_ID: string;
  API_ORIGIN: string;
  USE_MOCK_AI: string;
}
export type Card = {
  card_id: string;
  type: 'text' | 'image' | 'text_image';
  title: string;
  body: string | null;
  image_key: string | null;
  hints: string[];
  keywords: string[];
  source_file_id: string;
  source_page: number | null;
};
export type Transcript = {
  v: 1;
  event_id: string;
  type: 'transcript.partial'|'transcript.committed';
  session_id: string;
  seq: number;
  payload: {segment_id:string;text:string;revision?:number;speaker_id?:string|null;start_ms?:number|null;end_ms?:number|null};
};
export type Candidate = {id:string;type:Card['type'];title:string;body:string|null;hints:string[];keywords:string[]};
