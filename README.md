# Codex Peer

Codex Peer connects one Codex session to another Codex host through `codex app-server` remote WebSocket.

v1 is remote-only. It does not implement `codex exec`, local LLM summarization, scheduled jobs, or mechanical task status labels.

## Design

- `turn/completed` only means the peer Codex finished one response.
- The receiving Codex reads the peer's natural-language report and decides the next action.
- Long-running turns are normal. By default, `peer_message` returns `threadId` and `turnId` quickly so the turn can be checked later. For user-facing checks, `waitForCompletion: true` can keep the tool call quiet until completion or until the local wait window ends.
- A single long turn does not trigger user confirmation. The progress check is based on 5 peer turns in the same thread.

## Config

Set `CODEX_PEER_CONFIG` or create `~/.codex-peer/peers.json`.

```json
{
  "peers": {
    "windows": {
      "label": "Windows Codex",
      "url": "wss://codex-peer-win.s-original.com",
      "authTokenEnv": "CODEX_PEER_WINDOWS_TOKEN",
      "authTokenFile": "~/.codex-peer/windows.token",
      "defaultCwd": "C:\\Users\\shotaro\\code",
      "platform": "windows"
    }
  },
  "defaults": {
    "maxResponseChars": 8000,
    "progressCheckAfterTurns": 5,
    "waitWindowSeconds": 7200,
    "pollIntervalSeconds": 15
  }
}
```

The token value is read from `authTokenEnv` first, then `authTokenFile` if the environment variable is not set. It is not written to logs or transcripts.

## Tools

- `peer_health`: Connects to a peer app-server and runs `initialize`.
- `peer_message`: Sends a natural-language message to a peer thread.
- `peer_message` with `waitForCompletion: true`: Keeps the connection open and returns once the peer turn completes or the quiet wait window ends.
- `peer_wait`: Checks an existing peer turn.
- `peer_wait_until_complete`: Quietly follows an existing peer turn and returns a single result when it completes or the wait window ends.
- `peer_threads`: Lists peer threads.
- `peer_read`: Reads a peer thread.

For user-facing checks, prefer `peer_message` with `waitForCompletion: true` or `peer_wait_until_complete` so the assistant does not spend repeated chat turns saying that the peer is still running. Reaching `waitWindowSeconds` is not treated as peer task failure; it only means the local wait window ended.

## Check

```bash
npm install
npm run check
```

補足:
- `remote`: Codex TUI/app-serverのWebSocket接続。
- `turn`: Codexへの1回の依頼と返答のまとまり。
- `MCP`: Codexから外部ツールを呼ぶためのプロトコル。
