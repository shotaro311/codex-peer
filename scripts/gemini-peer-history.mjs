import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCliTranscript } from './gemini-peer-history-data.mjs';
import { HISTORY_HTML, HISTORY_JS, HISTORY_CSS } from './gemini-peer-history-ui.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_FILE = 6 * 1024 * 1024;
function readStates(stateDir, kind) {
  const values = [], warnings = [];
  const dir = path.join(stateDir, kind);
  let names;
  try { names = fs.readdirSync(dir); } catch { return { values, warnings: ['保存済みの履歴を読み取れません。'] }; }
  const candidates = names.filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5))).sort();
  if (candidates.length > 2000) warnings.push('履歴が多いため、読み取りは最大2,000件に制限されています。');
  for (const name of candidates.slice(0, 2000)) {
    try {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error();
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.version !== 1 || value.id !== name.slice(0, -5)) throw new Error();
      values.push(value);
    } catch { warnings.push('読み取れない保存履歴をスキップしました。'); }
  }
  return { values, warnings: [...new Set(warnings)] };
}
const str = value => typeof value === 'string' ? value : '';
function publicTurn(turn) {
  return { id: turn.id, status: str(turn.status), startedAt: str(turn.startedAt), completedAt: str(turn.completedAt),
    model: str(turn.model), inputText: typeof turn.inputText === 'string' ? turn.inputText : null,
    text: str(turn.text), error: str(turn.error?.message),
    toolFailures: (Array.isArray(turn.toolFailures) ? turn.toolFailures : []).map(f => ({ name: str(f.name), requiredPermission: str(f.requiredPermission) })) };
}
export function createHistoryHandler(peer) {
  return async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const port = peer.http?.address()?.port;
    const host = peer.config.listen.host === '::1' ? `[::1]:${port}` : `127.0.0.1:${port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        (req.headers['sec-fetch-site'] && !['none', 'same-origin'].includes(req.headers['sec-fetch-site']))) {
      send(403, { error: 'このMacの履歴画面からアクセスしてください。' }); return;
    }
    if (req.method !== 'GET') { send(405, { error: 'この画面は閲覧専用です。' }); return; }
    let url;
    try { url = new URL(req.url, `http://${host}`); }
    catch { return send(400, { error: "リクエストの形式が正しくありません。" }); }
    if (url.pathname === '/history' || url.pathname === '/history/') return send(200, HISTORY_HTML, 'text/html; charset=utf-8');
    if (url.pathname === '/history/app.js') return send(200, HISTORY_JS, 'text/javascript; charset=utf-8');
    if (url.pathname === '/history/app.css') return send(200, HISTORY_CSS, 'text/css; charset=utf-8');
    if (!url.pathname.startsWith('/history/api/')) return send(404, { error: 'ページが見つかりません。' });
    try {
      const threads = readStates(peer.config.stateDir, 'threads');
      if (url.pathname === '/history/api/threads') {
        return send(200, { threads: threads.values.sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt))).map(t => ({
          id: t.id, preview: str(t.preview), updatedAt: str(t.updatedAt), status: str(t.status) })), warnings: threads.warnings });
      }
      const id = url.pathname.slice('/history/api/threads/'.length);
      if (!url.pathname.startsWith('/history/api/threads/') || !UUID.test(id)) return send(404, { error: '会話が見つかりません。' });
      const thread = threads.values.find(t => t.id === id);
      if (!thread) return send(404, { error: '会話が見つかりません。' });
      const turns = readStates(peer.config.stateDir, 'turns');
      const transcript = UUID.test(thread.conversationId || '') ? await loadCliTranscript(thread.conversationId, { home: peer.env.HOME || peer.env.USERPROFILE || os.homedir() }) : { entries: [], warnings: [] };
      return send(200, { thread: { id, preview: str(thread.preview), createdAt: str(thread.createdAt), updatedAt: str(thread.updatedAt) },
        turns: turns.values.filter(t => t.threadId === id).sort((a, b) => str(a.startedAt).localeCompare(str(b.startedAt))).map(publicTurn),
        transcript: transcript.entries, warnings: [...new Set([...threads.warnings, ...turns.warnings, ...transcript.warnings])] });
    } catch { return send(500, { error: '履歴を読み取れませんでした。更新して再確認してください。' }); }
  };
}
