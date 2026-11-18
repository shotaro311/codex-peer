import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeUsage} from '../scripts/gemini-usage-collector.mjs';
import {readUsage} from '../scripts/gemini-peer-usage.mjs';
test('collector keeps quota zero and strips account, paths, context and raw fields',()=>{
  const data=normalizeUsage({email:'SECRET',cwd:'SECRET',model:{id:'flash-high',display_name:'Flash'},context_window:{total_input_tokens:99},quota:{'gemini-5h':{remaining_fraction:0,reset_time:'2026-09-14T09:00:00Z'},bad:{remaining_fraction:2,reset_time:'bad'}}},0);
  assert.equal(data.quotas[0].remainingFraction,0);assert.equal(data.quotas[1].remainingFraction,null);assert.equal(data.quotas[1].resetAt,null);
  assert.doesNotMatch(JSON.stringify(data),/SECRET|input_tokens|context_window/);
});
test('unknown quota is not zero; stale and configured reasoning are explicit',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-usage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const peer={config:{stateDir:dir,model:'gemini-3.8-flash-high'}};
  assert.equal(readUsage(peer).sample,null);assert.equal(readUsage(peer).reasoning,'high');assert.equal(readUsage(peer).stale,true);
  fs.writeFileSync(path.join(dir,'usage.json'),JSON.stringify(normalizeUsage({},1000)));
  assert.equal(readUsage(peer,2000).stale,false);assert.equal(readUsage(peer,400000).stale,true);
});
