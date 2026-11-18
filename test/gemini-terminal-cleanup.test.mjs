import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
const validateState = new AjvJsonSchemaValidator().getValidator(JSON.parse(fs.readFileSync(new URL('../schemas/gemini-peer-state.schema.json', import.meta.url))));
import { GeminiPeerServer, normalizeConfig } from '../scripts/gemini-peer-server.mjs';

async function scenario({mode='read-only', exitCode=null, denied=false, duplicate=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gemini-terminal-'));
  const config=normalizeConfig({stateDir:path.join(root,'state'),authTokenFile:path.join(root,'token'),timeoutMs:1000}, {HOME:root});
  for (const d of ['threads','turns']) fs.mkdirSync(path.join(config.stateDir,d),{recursive:true});
  let kills=0;
  const server=new GeminiPeerServer(config,{env:{HOME:root},terminalGraceMs:20,spawn:()=>{
    const child=new EventEmitter();
    child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.kill=()=>{kills++; queueMicrotask(()=>child.emit('close',null,'SIGTERM')); return true;};
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      const id=randomUUID(); const emit=e=>child.stdout.write(JSON.stringify(e)+'\n');
      emit({event:'init',conversation_id:id,init:{model:config.model,permission_mode:'request-review'}});
      if(denied) emit({event:'step_update',step_update:{tool_name:'run_command',tool_info:{error:{message:'permission check failed for command'}}}});
      const result={event:'result',result:{conversation_id:id,status:'SUCCESS',response:'Original complete response.'}};
      emit(result); if(duplicate) emit(result);
      if(exitCode!==null) child.emit('close',exitCode,null);
    }));
    return child;
  }});
  const thread={version:1,id:randomUUID(),cwd:root,conversationId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),preview:'',status:'idle'};
  server.save('threads',thread); config.defaultCwd=root; config.allowedRoots=[root];
  const started=server.startTurn({threadId:thread.id,input:[{type:'text',text:'Preserve this input.'}],executionMode:mode});
  await new Promise(resolve=>setTimeout(resolve,60));
  const turn=server.read('turns',started.turn.id); const snapshot={turn,kills};
  await server.close();
  fs.rmSync(root,{recursive:true,force:true});
  return snapshot;
}

test('a verified read-only terminal result survives a stuck CLI cleanup without inventing exit zero',async()=>{
  const {turn,kills}=await scenario();
  assert.equal(kills,1); assert.equal(turn.status,'completed'); assert.equal(turn.text,'Original complete response.');
  assert.equal(turn.inputText,'Preserve this input.'); assert.equal(turn.error,null);
  assert.equal(validateState(turn).valid,true,JSON.stringify(validateState(turn)));
  assert.equal(turn.completionEvidence.basis,'terminal_result_after_cleanup');
  assert.equal(turn.completionEvidence.exitCode,null); assert.equal(turn.completionEvidence.exitSignal,'SIGTERM');
  assert.match(turn.completionEvidence.outputSha256,/^[0-9a-f]{64}$/);
});
test('an actual failing exit before cleanup is still a failure',async()=>{
  const {turn,kills}=await scenario({exitCode:1}); assert.equal(kills,0); assert.equal(turn.status,'failed'); assert.equal(turn.completionEvidence,undefined);
});
test('denied tools and duplicate terminal results cannot be accepted',async()=>{
  for (const config of [{denied:true,exitCode:0},{duplicate:true}]) {
    const {turn}=await scenario(config); assert.equal(turn.status,'failed'); assert.equal(turn.completionEvidence,undefined);
  }
});
test('workspace writes retain the original clean-exit requirement',async()=>{
  const {turn,kills}=await scenario({mode:'workspace-write'}); assert.equal(kills,0); assert.equal(turn.status,'inProgress'); assert.equal(turn.completionEvidence,undefined);
});
