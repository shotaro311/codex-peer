# Gemini Peer setup

Gemini Peer runs a local authenticated WebSocket receiver, translates the existing Codex Peer requests to the official Antigravity CLI, and saves results for later readback. Use Node.js 22 or newer on macOS or native Windows. The same JavaScript server runs on both platforms; actual login and execution must be tested separately on each host.

## Install and authenticate

Use Google's [platform-specific installation instructions](https://antigravity.google/docs/cli/install/). The documented native binary paths are `~/.local/bin/agy` on Mac and `%LOCALAPPDATA%\agy\bin\agy.exe` on Windows. Review the official installer before running it and retain existing shell configuration where possible.

Launch `agy` interactively once and sign in with the authorized Google account. The CLI manages OAuth in the OS credential store. Do not copy tokens, extract keyring contents, or add an API key. Verify the account and plan in the CLI, then inspect `agy models` for the chosen Gemini 3.8 Flash slug. Listing models is separate from sending a model task.

The adapter strips API credential/endpoint environment variables from the child and rejects a configured `modelProvider` or enabled `useG1Credits`. It does not change the user's Antigravity settings. Leave `modelProvider` absent for account authentication and additional credits fallback disabled. [Google's settings documentation](https://antigravity.google/docs/cli/settings/) describes `useG1Credits` as using personal AI credits when the standard quota is exhausted. These settings are checked before every task spawn: there is no automatic additional-credits or API fallback.

## Configure the receiver

After the official CLI is installed, the repository's local installer can generate the private configuration, token, peer entry, and login-start service definition. It does not install Antigravity, log in, send model requests, or change command permissions.

```text
node scripts/install-gemini-peer.mjs --default-cwd /absolute/delegation-workspace --allowed-root /absolute/delegation-workspace --agy-bin /absolute/path/to/agy --dry-run
node scripts/install-gemini-peer.mjs --default-cwd /absolute/delegation-workspace --allowed-root /absolute/delegation-workspace --agy-bin /absolute/path/to/agy --apply
```

Use native `.exe` paths on Windows; quote arguments containing spaces. Optional `--node-bin`, `--server-script`, `--state-dir`, `--peers-config`, and `--model` select explicit local paths/model. The default server path is `dist/gemini-peer-server.mjs`, so build the plugin first. `--allowed-root` can be repeated and defaults to the specified workspace.

Dry-run is the default and prints concrete public changes without creating a token or files. Apply creates `config.json` and `peer-token` under `.gemini-peer`, preserves existing compatible files, and merges only the `gemini` entry into `peers.json`. Existing peer fields are preserved; a unique private backup is created before a merge. Conflicting configuration or service definitions stop installation rather than being replaced.

Add `--activate` alongside `--apply` to register and start only the Gemini service. Mac uses `~/Library/LaunchAgents/com.codex-peer.gemini.plist`. Windows generates a hidden WScript launcher and `register-gemini-peer-task.ps1`, which registers an interactive-user Task Scheduler task named `CodexGeminiPeer`. Existing registrations are not replaced or restarted. Without `--activate`, the files are prepared but no service is registered.

After activation, check `peer_health` separately. Installer success confirms configuration readback, not authenticated Gemini execution. Token content is never printed. Mac state files use private modes; Windows applies a current-user directory ACL before token creation. Existing broad private-file ACLs are rejected for review. No other services are changed.

For manual setup, use the equivalent configuration below.

Create a random local peer token file with at least 24 bytes of entropy. Protect it with `0600` on Mac and an owner-only ACL on Windows. This is a local receiver credential, separate from Google OAuth. Keep its value out of repository files and chat output.

Save a receiver configuration outside the repository, for example `~/.gemini-peer/config.json`:

```json
{
  "listen": { "host": "127.0.0.1", "port": 17848 },
  "authTokenFile": "/absolute/path/to/gemini-peer-token",
  "agyBin": "/absolute/path/to/agy",
  "defaultCwd": "/absolute/path/to/delegation-workspace",
  "allowedRoots": ["/absolute/path/to/delegation-workspace"],
  "model": "gemini-3.8-flash-medium",
  "executionMode": "read-only",
  "timeoutMs": 1800000,
  "maxConcurrentTurns": 2
}
```

On Windows, use absolute Windows paths with JSON-escaped backslashes, or forward slashes. Set `agyBin` to the native `.exe`, not a shell alias or `.cmd` shim. `stateDir` defaults to `.gemini-peer` under the user's home. The only supported models are `gemini-3.8-flash-medium` and `gemini-3.8-flash-high`.

Start the server:

```text
node scripts/gemini-peer-server.mjs /absolute/path/to/config.json
```

Register a peer in the existing `peers.json`, preserving other entries:

```json
{
  "peers": {
    "gemini": {
      "url": "ws://127.0.0.1:17848",
      "authTokenFile": "/absolute/path/to/gemini-peer-token",
      "defaultCwd": "/absolute/path/to/delegation-workspace"
    }
  }
}
```

The WebSocket receiver accepts authenticated non-browser loopback clients only. For another host, use an authenticated tunnel to loopback or an existing authenticated TLS reverse proxy; do not expose this HTTP receiver directly. A health result confirms connectivity only and sends no Gemini prompt.

## Read-only browser history

Open `http://127.0.0.1:17848/history` on the receiver machine (use the configured port, or `[::1]` for an IPv6 listener). The Japanese interface lists saved Peer conversations, searches request previews, and shows requests, responses, tool names and saved execution failures. Refresh is manual and never sends a Gemini request.

New turns preserve the exact input in optional `inputText`, within the existing version 1 state contract. Older state needs no migration. Existing requests can be recovered read-only from the official CLI's `brain/<conversationId>/.system_generated/logs/transcript_full.jsonl`. Missing inputs are explicitly marked unavailable. Thinking, system messages, tool arguments and tool results are excluded. The CLI transcript may omit tool failures, so saved Peer execution records remain separately available. No CLI database or index is modified.

The history endpoints are local read-only HTTP, without the execution token. They require the exact loopback Host and reject foreign Origin and cross-site/same-site browser requests. They set no-store, same-origin resource policy and a restrictive Content Security Policy; content is rendered as text. Local OS processes can read this interface, as they can read the user-owned state. Do not forward or publicly expose the history port. The existing authenticated WebSocket execution API is unchanged.

Reads are bounded to 2,000 records per state directory, 6 MiB per state file, and 16 MiB / 100,000 lines per CLI transcript; partial/unreadable histories display warnings. Rolling back the server leaves optional input fields harmless to older v1 readers. Keep saved state when rolling back.

## Modes and command permissions

`peer_message.executionMode` selects `read-only` (default, `agy --mode plan`) or `workspace-write` (`agy --mode accept-edits`). The model is pinned by server configuration. The server uses argument arrays with `shell: false` and `windowsHide: true`, and sends the task as NDJSON on stdin. It never passes the task through a shell command string.

[Plan mode](https://antigravity.google/docs/cli/modes/) is an instruction to analyze before editing, not a filesystem sandbox. `allowedRoots` validates the selected working directory and is an operational delegation boundary, not OS containment of every tool call. Give strict read-only tasks a sanitized packet or separately protected copy. Use separate worktrees when parent and child edit concurrently.

Keep [Antigravity permission rules](https://antigravity.google/docs/cli/permissions/) scoped to the actual project and test commands. A selected workspace can still require `read_file(/absolute/delegation-workspace)` for directory discovery: this was observed with `list_dir` in AGY 1.2.0 even though direct authorized file creation worked. Grant that specific root only when its read access is in the delegated scope. Allow the exact test command required by the task after reviewing its scripts. The adapter does not add `--dangerously-skip-permissions`, modify global permissions, or approve arbitrary commands. Ask/denied tools may prevent unattended discovery or tests; the failure reports the tool and required permission without returning raw diagnostics or private target paths.

## Completion and recovery

Each turn uses one [streaming CLI process](https://antigravity.google/docs/cli/headless/). The adapter closes stdin after the task, checks the initialization and final result, waits for process exit, persists the terminal state, then broadcasts `turn/completed`. A later turn resumes the exact saved `conversation_id`. Caller disconnects do not cancel work.

CLI success and task acceptance are separate. The adapter requires the configured model, a matching conversation, nonempty response, `SUCCESS`, and exit code zero. Observed denied permissions or tool errors produce a failed peer turn even if the CLI returned success. Diagnostic matching is conservative and is not an exhaustive proof that no action was blocked. The parent must inspect changes and test evidence.

The parent completion-notification layer consumes this same event/result contract. This receiver alone does not wake a stopped Codex task; use the shared notification bridge for asynchronous delivery. Do not implement a recurring parent-model polling loop.

State is stored as version 1 JSON under `threads/` and `turns/` in the receiver state directory using atomic replacement. The contract is [gemini-peer-state.schema.json](../schemas/gemini-peer-state.schema.json); [representative fixtures](../test/fixtures/gemini-peer-states.json) cover new/resumed threads, running/successful turns, permission denial, and interruption. Optional diagnostics preserve older v1 records without migration. The receiver takes an ownership lock. After restart it marks unresolved work interrupted without resending; if the previous runner PID is still alive, startup stops for inspection. Preserve state and inspect the work before retrying. No existing Codex Peer state migration is required. Roll back by stopping this receiver and removing its peer configuration entry; retain its state for inspection.

## Verification gates

- Run `node --test test/gemini-peer-server.test.mjs` for the protocol, failure, authentication, and recovery fixtures.
- On each OS verify real `agy` login, exact model initialization, a read-only request, conversation continuation, an isolated edit, and an explicitly permitted test command.
- Verify a denied command is reported as blocked, and quota/login failures never trigger API fallback or task resend.
- Disconnect the requesting client during a long test and verify persisted terminal readback plus one notification to the parent. Confirm no parent-model calls occur during the wait.

Fixture tests and Windows path construction do not replace Windows native execution or live parent-notification verification.
