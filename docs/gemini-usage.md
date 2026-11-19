# Gemini Peer usage display

The history page shows the configured model/effort, the model observed by the official CLI, quota remaining fractions, reset timestamps and capture time. Unknown values remain unknown. Fractions are subscription quota, not an estimate of remaining tokens. Captures older than five minutes are marked stale.

`GET /history/api/usage` reads the saved snapshot only. The **利用状況を取得** button calls `POST /history/api/usage/refresh`, requiring the exact loopback Origin as well as the history Host/Fetch checks. Requests are coalesced and rate limited to one per 30 seconds. No public or authenticated remote MCP quota endpoint is added.

Refresh starts the official `agy` TUI in the configured dedicated workspace using node-pty, sends only the built-in `/usage` command after the prompt is ready, waits for the quota panel and statusLine JSON, and terminates that child. A trust prompt is not approved. Authentication failures/timeouts retain the old snapshot with an error instead of reporting success. Model prompts, API-key fallback and AI-credit fallback are not used. This depends on the CLI's TUI labels; changes may require updating the readiness detection.

## Optional local setup

1. Install the repository dependencies with `npm ci`. `node-pty` 1.1.0 is a native runtime dependency and must be available via `node_modules` next to the deployed bundle (built/installed for the target OS). Copying the server bundle alone does not install this feature.
2. Copy `scripts/gemini-usage-collector.mjs` to a stable local path.
3. Back up `~/.gemini/antigravity-cli/settings.json`. Add the official `statusLine` command invoking Node and that collector, with `type: "command"` and `stack_with_default: true`. Preserve other settings; if a custom statusLine already exists, integrate deliberately rather than overwrite it. Test shell quoting on the target OS.
4. On the tested Windows machine, the command uses the verified short Node path `C:\PROGRA~1\nodejs\node.exe` and the space-free collector path under `~\.gemini-peer`. Do not assume this alias exists on another machine.
5. Reload `/history`, click **利用状況を取得**, and verify capture time advances. The collector whitelists quota/model/version only; email, working directory, transcript, credentials and context-window payload are not persisted. `GEMINI_PEER_USAGE_CAPTURE` is set only for the dedicated refresh child.

The snapshot is `~/.gemini-peer/usage.json`. Rollback: stop the Gemini receiver, restore the backed-up server bundle and the previous `statusLine` field, then restart it. Do not restore unrelated settings from an old full settings backup over newer user edits.

Verified on Windows with AGY 1.2.2 and Node 24.16.0. Mac live acceptance is not performed for this feature.

Official interfaces: https://antigravity.google/docs/cli/statusline/ and https://antigravity.google/docs/cli/commands/usage
