---
name: codex-peer
description: Use a separately running Codex on another computer through the Codex app-server WebSocket API. Trigger when the user asks to contact, instruct, inspect, or wait for a peer Codex such as a Windows or Mac Codex instance. Supports projectless peer tasks and existing peer threads.
---

# Codex Peer

## Purpose

Use Codex Peer when the requested work must happen through a separately running Codex on another configured host.

Prefer native Codex remote features when they fully cover the request. Codex Peer is for symmetric peer-to-peer work, projectless tasks, and tasks that depend on the peer computer's local environment.

## Safety rules

- Treat `peer_message` as a potentially destructive external action. The peer may use its own tools and permissions.
- Do not send secrets unless the user explicitly placed them in scope and the transfer is necessary.
- Run `peer_health` before the first task when connection state is unknown.
- Do not treat `peer_health` as proof that Computer Use, Browser Use, a browser extension, or any other peer-local capability is callable.
- Do not infer success from an empty response.
- A `failed` or `interrupted` `turnStatus` is a failure even though the turn is terminal.
- Do not claim completion until `turnSucceeded` is `true` or peer readback provides equivalent evidence.
- Do not expose tokens, peer URLs containing credentials, or transcript paths in user-facing output unless necessary.

## Capability-aware delegation

Codex Peer delegates work to another Codex. It does not transfer the caller's tools, browser session, cookies, permissions, or desktop access to the peer.

When a task depends on Computer Use, Browser Use, a browser extension, or another peer-local capability:

1. Route the task to the host where the target application, browser profile, files, and authenticated session actually exist.
2. Tell the peer to read and use the relevant local skill before acting. Name the capability explicitly in the message.
3. Ask the peer to run a harmless read-only preflight before consequential work:
   - Computer Use: list applications or inspect the target application's state.
   - Browser Use: inspect the current page or open a harmless page.
   - Browser extension: confirm the required browser/profile connection and current URL without changing state.
4. Choose the browser path based on the peer's local environment. Prefer an attached browser extension for an existing signed-in browser session, Browser Use for its supported browser surface, and Computer Use for desktop applications or as a fallback.
5. If a plugin, skill, or tool was just installed or updated, prefer a new peer thread so the receiving Codex can load the current capability set.
6. If the preflight fails or the capability is not exposed, stop that path and report the capability-specific blocker. Do not report it as a generic Codex Peer connection failure.

Installed or enabled plugin metadata is supporting evidence only. The capability preflight is the completion gate for deciding that a peer can use that tool in the current session.

## Workflow

1. Select the configured `peerId` that matches the target computer.
2. Use `peer_health` if the connection has not been verified in the current task.
3. If the task needs a peer-local capability, include the capability name, relevant skill, target host context, and read-only preflight in the request.
4. Use `peer_message` with a clear natural-language request.
5. For a projectless task, start a new thread without `cwd` or `defaultCwd`.
6. For an existing task, pass its `threadId` and continue the same thread unless a newly installed or updated capability requires a fresh thread.
7. For user-facing work that may take time, set `waitForCompletion: true` or use `peer_wait_until_complete` with the returned `threadId` and `turnId`.
8. Read `ok`, `turnStatus`, `turnSucceeded`, `turnError`, and the peer's natural-language report before deciding the next action.
9. For capability-dependent work, verify both the preflight and the final peer-local readback.
10. Summarize the result for the user. Do not repeatedly report unchanged in-progress states.

## Turn interpretation

- `turnCompleted: false`: the peer turn is still running; preserve its IDs and wait later.
- `turnCompleted: true`, `turnSucceeded: true`: the peer turn completed successfully.
- `turnCompleted: true`, `turnSucceeded: false`: the peer turn failed or was interrupted; report the sanitized error and decide whether retrying is safe.
- An expired wait window is not a peer-task failure and does not cancel the peer turn.

`turn/completed` means one peer response reached a terminal state. It does not prove that the user's overall objective is finished.

## User-facing output

Report the outcome, material evidence from the peer, the next action, and any user decision required. Avoid pasting long peer transcripts or internal identifiers unless they are needed for recovery.
