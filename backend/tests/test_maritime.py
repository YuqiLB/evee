"""Run: python -m unittest discover -s tests -p 'test_*.py' -v"""
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'maritime'))
os.environ['MARITIME_SERVICE_TOKEN']='test-maritime-secret'

from fastapi.testclient import TestClient
import main

class MaritimeTest(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(main.app)
        self.headers={'Authorization':'Bearer test-maritime-secret'}
    def test_health(self):
        self.assertTrue(self.client.get('/health').json()['ok'])
    def test_requires_authorization(self):
        self.assertEqual(self.client.post('/v1/context',json={}).status_code,401)
    def test_selection_limits_and_ids(self):
        response={'selected_card_ids':['a','b','c','d','e','f','bogus'], 'end_candidate':True,'end_confidence':0.95}
        candidates=[{'id':x,'title':x,'type':'image' if x in 'abcd' else 'text','hints':[],'keywords':[]} for x in 'abcdef']
        with patch.object(main,'model_json',new=AsyncMock(return_value=response)):
            r=self.client.post('/v1/context',headers=self.headers,json={
                'session_id':'sess','revision':7,'recent_text':'goodbye','rolling_context':'goodbye',
                'candidates':candidates,'shown_card_ids':[]})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['selected_card_ids'],['a','b','c','e','f'])
        self.assertTrue(r.json()['end_candidate'])
    def test_summary_empty_transcript(self):
        r=self.client.post('/v1/summarize',headers=self.headers,json={'session_id':'sess','transcript':[]})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['title'],'Empty conversation')
    def test_ingest_image(self):
        class FakeResponse:
            content=b'test-image'
        extraction={'cards':[{'type':'text_image','title':'battery diagram','body':'battery chemistry','asset_ref':0,'hints':['when batteries discussed'],'keywords':['battery'],'source_page':None}]}
        with patch.object(main,'cloudflare',new=AsyncMock(return_value=FakeResponse())), patch.object(main,'model_json',new=AsyncMock(return_value=extraction)):
            r=self.client.post('/v1/ingest',headers=self.headers,json={
                'dataset_id':'d','version':1,'file_id':'f','filename':'image.png','mime_type':'image/png','r2_key':'uploads/d/f'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['asset_keys'],['uploads/d/f'])
        self.assertEqual(r.json()['cards'][0]['asset_ref'],0)

class ModelJsonTest(unittest.IsolatedAsyncioTestCase):
    def fake_client(self,stop_reason='end_turn',text='{"selected_card_ids":["a"]}'):
        from types import SimpleNamespace as NS
        create=AsyncMock(return_value=NS(stop_reason=stop_reason,content=[NS(type='thinking'),NS(type='text',text=text)]))
        return NS(beta=NS(messages=NS(create=create))),create
    async def test_fast_call_uses_schema_low_effort_no_fallback(self):
        client,create=self.fake_client()
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test'}),patch.object(main,'_model_client',client):
            out=await main.model_json(main.FAST_MODEL,'sys','hi',main.CONTEXT_SCHEMA)
        self.assertEqual(out,{'selected_card_ids':['a']})
        kw=create.call_args.kwargs
        self.assertEqual(kw['output_config']['effort'],'low')
        self.assertEqual(kw['output_config']['format']['schema'],main.CONTEXT_SCHEMA)
        self.assertNotIn('fallbacks',kw)
    async def test_smart_call_has_fallback_and_refusal_is_502(self):
        client,create=self.fake_client(stop_reason='refusal')
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test'}),patch.object(main,'_model_client',client):
            with self.assertRaises(main.HTTPException) as e:
                await main.model_json(main.SMART_MODEL,'sys','hi',main.SUMMARY_SCHEMA)
        self.assertEqual(e.exception.status_code,502)
        self.assertEqual(create.call_args.kwargs['fallbacks'],'default')
    async def test_missing_key_is_503(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(main.HTTPException) as e:
                await main.model_json(main.FAST_MODEL,'sys','hi',main.CONTEXT_SCHEMA)
        self.assertEqual(e.exception.status_code,503)

if __name__=='__main__':unittest.main()
