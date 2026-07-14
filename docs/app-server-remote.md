# App-server behavior

Codex Peer communicates with `codex app-server` over WebSocket. This interface is experimental, so release compatibility must be verified against the current Codex version.

## Turn states

`turn/completed` is a terminal event, not an automatic success signal. Codex Peer distinguishes these states:

| Peer status | `turnCompleted` | `turnSucceeded` | `ok` |
| --- | --- | --- | --- |
| running | `false` | `null` | `true` |
| completed | `true` | `true` | `true` |
| failed | `true` | `false` | `false` |
| interrupted | `true` | `false` | `false` |

If a turn is still running, keep the returned `threadId` and `turnId`. Use `peer_wait_until_complete` for quiet monitoring or `peer_wait` for a short snapshot.

`waitWindowSeconds` is a local wait window. Reaching it does not stop the peer turn and does not mean the peer task failed.

## Natural-language reports

The peer is not required to emit a custom status label. The calling Codex reads the peer's report, the app-server turn status, and any sanitized error, then decides the next action.

## Compatibility checks

Before a release:

1. Run `npm run check`.
2. Start a current `codex app-server` on loopback with token authentication.
3. Verify `peer_health`, one successful task, one long-running task, and one failed task.
4. Repeat on each supported operating system.
