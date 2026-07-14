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
- Do not infer success from an empty response.
- A `failed` or `interrupted` `turnStatus` is a failure even though the turn is terminal.
- Do not claim completion until `turnSucceeded` is `true` or peer readback provides equivalent evidence.
- Do not expose tokens, peer URLs containing credentials, or transcript paths in user-facing output unless necessary.

## Workflow

1. Select the configured `peerId` that matches the target computer.
2. Use `peer_health` if the connection has not been verified in the current task.
3. Use `peer_message` with a clear natural-language request.
4. For a projectless task, start a new thread without `cwd` or `defaultCwd`.
5. For an existing task, pass its `threadId` and continue the same thread.
6. For user-facing work that may take time, set `waitForCompletion: true` or use `peer_wait_until_complete` with the returned `threadId` and `turnId`.
7. Read `ok`, `turnStatus`, `turnSucceeded`, `turnError`, and the peer's natural-language report before deciding the next action.
8. Summarize the result for the user. Do not repeatedly report unchanged in-progress states.

## Turn interpretation

- `turnCompleted: false`: the peer turn is still running; preserve its IDs and wait later.
- `turnCompleted: true`, `turnSucceeded: true`: the peer turn completed successfully.
- `turnCompleted: true`, `turnSucceeded: false`: the peer turn failed or was interrupted; report the sanitized error and decide whether retrying is safe.
- An expired wait window is not a peer-task failure and does not cancel the peer turn.

`turn/completed` means one peer response reached a terminal state. It does not prove that the user's overall objective is finished.

## User-facing output

Report the outcome, material evidence from the peer, the next action, and any user decision required. Avoid pasting long peer transcripts or internal identifiers unless they are needed for recovery.
