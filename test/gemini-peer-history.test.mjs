import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GeminiPeerServer, normalizeConfig } from '../scripts/gemini-peer-server.mjs';

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-history-'));
  const token = path.join(root, 'token');
  fs.writeFileSync(token, 'test-only-secret-do-not-expose-12345678', {mode:0o600});
  let spawns=0;
  const peer=new GeminiPeerServer(normalizeConfig({stateDir:path.join(root,'state'),authTokenFile:token,listen:{port:0}},{HOME:root}),{env:{HOME:root},spawn:()=>{spawns++;throw new Error('must not run');}});
  const address=await peer.listen();
  t.after(async()=>{await peer.close();fs.rmSync(root,{recursive:true,force:true});});
  const req=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port:address.port,path:url,headers,method},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});r.on('error',reject);r.end();
  });
  return {root,peer,req,spawns:()=>spawns};
}
test('history is read only and rejects foreign hosts, origins, fetch contexts and mutations',async t=>{
  const f=await setup(t);
  assert.equal((await f.req('/history')).status,200);
  assert.equal((await f.req('//[')).status,400);
  assert.equal((await f.req('/history')).status,200);
  for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])assert.equal((await f.req('/history/api/threads',headers)).status,403);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await f.req('/history/api/threads',{},method)).status,405);
  assert.equal((await f.req('/history/api/threads/../../token')).status,404);
  assert.equal(f.spawns(),0);
});
test('lists old and new records without secret config, accepts missing input, and skips corrupt files',async t=>{
  const f=await setup(t),thread=f.peer.handleRequest('thread/start',{}).thread;
  f.peer.save('threads',{...thread,preview:'<script>alert(1)</script>'});
  const old={version:1,id:randomUUID(),threadId:thread.id,status:'failed',startedAt:'2026-09-10T10:00:00Z',text:'saved response',error:{message:'permission denied'},runnerPid:123,model:'test-model'};
  f.peer.save('turns',old);
  f.peer.save('turns',{...old,id:randomUUID(),startedAt:'2026-09-11T10:00:00Z',inputText:'new request'});
  fs.writeFileSync(path.join(f.peer.config.stateDir,'turns',randomUUID()+'.json'),'{broken');
  const before=fs.readFileSync(f.peer.file('turns',old.id),'utf8');
  const response=await f.req('/history/api/threads/'+thread.id);
  assert.equal(response.status,200);
  const data=JSON.parse(response.body);
  assert.equal(data.turns.length,2);assert.equal(data.turns[0].inputText,null);assert.equal(data.turns[1].inputText,'new request');assert.ok(data.warnings.length);
  assert.doesNotMatch(response.body,/runnerPid|authToken|test-only-secret|settingsFile/);
  assert.equal(fs.readFileSync(f.peer.file('turns',old.id),'utf8'),before);
  const shell=await f.req('/history');
  assert.match(shell.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal(shell.headers['cache-control'],'no-store');
  assert.doesNotMatch(shell.body,/<script>alert/);
  assert.equal(f.spawns(),0);
});

test('partial CLI exports preserve saved inputs and responses without duplicating intact messages', async () => {
  const {historyMessages}=await import('../scripts/gemini-peer-history-ui.mjs');
  const turn={inputText:'saved prompt',text:'saved reply',startedAt:'2026-09-11T01:00:00Z',completedAt:'2026-09-11T01:01:00Z'};
  const assistant={role:'assistant',text:'saved reply\n',createdAt:'2026-09-11T01:00:59Z'};
  const partial=historyMessages({turns:[turn],transcript:[assistant]});
  assert.deepEqual(partial.map(e=>e.text),['saved prompt','saved reply\n']);
  const user={role:'user',text:'saved prompt',createdAt:'2026-09-11T01:00:01Z'};
  assert.equal(historyMessages({turns:[turn],transcript:[user,assistant]}).length,2);
  assert.equal(historyMessages({turns:[{...turn,inputText:null}],transcript:[user,assistant]}).length,2);
});

test('repeated close turns stay separate and CLI request wrappers do not duplicate saved inputs',async()=>{
  const {historyMessages}=await import('../scripts/gemini-peer-history-ui.mjs');
  const a={inputText:'続けて',text:'完了',startedAt:'2026-09-11T01:00:00Z',completedAt:'2026-09-11T01:00:01Z'};
  const b={...a,startedAt:'2026-09-11T01:00:02Z',completedAt:'2026-09-11T01:00:03Z'};
  assert.equal(historyMessages({turns:[a,b],transcript:[]}).length,4);
  const transcript=[{role:'user',text:'<USER_REQUEST>receiver prefix 続けて</USER_REQUEST>',createdAt:a.startedAt}];
  const merged=historyMessages({turns:[a],transcript});
  assert.equal(merged.filter(e=>e.role==='user').length,1);
  assert.equal(merged[0].text,'続けて');
});
