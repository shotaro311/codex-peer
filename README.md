# Codex Peer

Codex Peer connects one Codex session to another Codex host through `codex app-server` remote WebSocket.

v1 is remote-only. It does not implement `codex exec`, local LLM summarization, scheduled jobs, or mechanical task status labels.

## Design

- `turn/completed` only means the peer Codex finished one response.
- The receiving Codex reads the peer's natural-language report and decides the next action.
- Long-running turns are normal. `peer_message` does not block for an hour; it returns `threadId` and `turnId` so the turn can be checked later.
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
      "defaultCwd": "C:\\Users\\shotaro\\code",
      "platform": "windows"
    }
  },
  "defaults": {
    "maxResponseChars": 8000,
    "progressCheckAfterTurns": 5
  }
}
```

The token value is read from the environment variable named by `authTokenEnv`. It is not written to logs or transcripts.

## Tools

- `peer_health`: Connects to a peer app-server and runs `initialize`.
- `peer_message`: Sends a natural-language message to a peer thread.
- `peer_wait`: Checks an existing peer turn.
- `peer_threads`: Lists peer threads.
- `peer_read`: Reads a peer thread.

## Check

```bash
npm install
npm run check
```

補足:
- `remote`: Codex TUI/app-serverのWebSocket接続。
- `turn`: Codexへの1回の依頼と返答のまとまり。
- `MCP`: Codexから外部ツールを呼ぶためのプロトコル。
