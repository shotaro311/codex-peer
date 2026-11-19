import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire as usageRequire } from 'node:module';
import { checkSubscriptionSettings, subscriptionEnv } from './gemini-peer-server.mjs';
const loadNative = usageRequire(import.meta.url);
const pending = new WeakMap();
const attempts = new WeakMap();
export function readUsage(peer, now = Date.now()) {
  let sample = null;
  try { sample = JSON.parse(fs.readFileSync(path.join(peer.config.stateDir, 'usage.json'), 'utf8')); } catch {}
  const age = now - Date.parse(sample?.observedAt);
  return { configuredModel: peer.config.model, reasoning: peer.config.model.match(/-(high|medium|low)$/)?.[1] || null,
    sample, stale: !Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000,
    refreshing: pending.has(peer), lastAttempt: attempts.get(peer) || null };
}
export async function refreshUsage(peer) {
  if (pending.has(peer)) return pending.get(peer);
  const recent = attempts.get(peer);
  if (recent && Date.now() - Date.parse(recent.at) < 30000) return readUsage(peer);
  const task = captureUsage(peer).then(result => { attempts.set(peer, {at:new Date().toISOString(), ...result}); })
    .catch(() => { attempts.set(peer, {at:new Date().toISOString(), ok:false, error:'CLIの利用状況を取得できませんでした。認証とステータス表示設定を確認してください。'}); })
    .finally(() => pending.delete(peer)).then(() => readUsage(peer));
  pending.set(peer, task); return task;
}
async function captureUsage(peer) {
  checkSubscriptionSettings(peer.config);
  const settings = JSON.parse(fs.readFileSync(peer.config.settingsFile, 'utf8'));
  if (!settings.statusLine?.command?.includes('gemini-usage-collector.mjs') || settings.statusLine.enabled === false) throw new Error('collector absent');
  const pty = loadNative('node-pty');
  const capture = path.join(peer.config.stateDir, 'usage-capture-' + randomUUID() + '.json');
  const child = pty.spawn(peer.config.agyBin, ['--model', peer.config.model, '--mode', 'plan'], {
    name:'xterm-256color', cols:140, rows:45, cwd:peer.config.defaultCwd,
    env: {...subscriptionEnv(peer.env), GEMINI_PEER_USAGE_CAPTURE:capture}, useConpty:true
  });
  return new Promise((resolve, reject) => {
    let tail='', sent=false, panel=false, finished=false, timer, poll;
    const finish = (error, sample) => {
      if (finished) return; finished=true; clearTimeout(timer); clearInterval(poll);
      try { child.kill(); } catch {}
      try { fs.unlinkSync(capture); } catch {}
      if (error) reject(new Error('usage unavailable'));
      else {
        const file=path.join(peer.config.stateDir,'usage.json'), temp=file+'.tmp';
        try { fs.writeFileSync(temp, JSON.stringify(sample), {mode:0o600}); fs.renameSync(temp,file); resolve({ok:true}); } catch { reject(new Error('save failed')); }
      }
    };
    child.onData(chunk => {
      tail=(tail+chunk).slice(-16000);
      const plain=tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
      if (/Do you trust|Paste.*code|Open.*browser.*sign in/i.test(plain)) return finish(true);
      if (!sent && /\? for shortcuts/.test(plain)) {
        sent=true; tail='';
        try { fs.unlinkSync(capture); } catch {}
        child.write('/usage\r');
      }
      if (sent && /Models & Quota/.test(plain) && /Remaining|remaining/.test(plain)) panel=true;
    });
    child.onExit(() => { if (!finished) finish(true); });
    poll=setInterval(() => {
      if (!panel) return;
      try { const sample=JSON.parse(fs.readFileSync(capture,'utf8')); if (sample.quotas?.length) finish(false,sample); } catch {}
    },250);
    timer=setTimeout(() => finish(true),25000);
  });
}
