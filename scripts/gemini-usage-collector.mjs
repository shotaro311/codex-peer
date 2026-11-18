// Official AGY statusLine stdin only. Never persist the raw payload.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function normalizeUsage(data, now = Date.now()) {
  const text = x => typeof x === 'string' ? x.slice(0, 160) : null;
  const quotas = Object.entries(data?.quota || {}).slice(0, 40).map(([id, q]) => ({
    id: text(id), remainingFraction: typeof q?.remaining_fraction === 'number' && q.remaining_fraction >= 0 && q.remaining_fraction <= 1 ? q.remaining_fraction : null,
    resetAt: typeof q?.reset_time === 'string' && Number.isFinite(Date.parse(q.reset_time)) ? new Date(q.reset_time).toISOString() : null
  }));
  return { version: 1, observedAt: new Date(now).toISOString(), model: {id: text(data?.model?.id), name: text(data?.model?.display_name)},
    cliVersion: text(data?.version), quotas };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) process.exit(1); }
  try {
    const data = normalizeUsage(JSON.parse(input));
    const target = process.env.GEMINI_PEER_USAGE_CAPTURE;
    if (target && path.isAbsolute(target)) {
      const temp = target + '.' + process.pid + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(data), {mode: 0o600}); fs.renameSync(temp, target);
    }
    process.stdout.write('');
  } catch { process.exitCode = 1; }
}
