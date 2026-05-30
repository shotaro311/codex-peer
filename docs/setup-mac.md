# Mac Setup

## 1. Install dependencies

```bash
cd /Users/shotaro/code/share/codex-peer
npm install
npm run check
```

## 2. Create peer config

```bash
mkdir -p ~/.codex-peer
vi ~/.codex-peer/peers.json
```

Example:

```json
{
  "peers": {
    "windows": {
      "label": "Windows Codex",
      "url": "wss://codex-win.s-original.com",
      "authTokenEnv": "CODEX_PEER_WINDOWS_TOKEN",
      "defaultCwd": "C:\\Users\\shota\\code",
      "platform": "windows"
    }
  },
  "defaults": {
    "maxResponseChars": 8000,
    "progressCheckAfterTurns": 5
  }
}
```

## 3. Set token env

```bash
export CODEX_PEER_WINDOWS_TOKEN="..."
```

Do not put the token value in docs, transcripts, or shared prompts.

## 4. Peer app-server expectation

The Windows side should expose a TLS WebSocket endpoint that forwards to:

```powershell
codex app-server --listen ws://127.0.0.1:17843 --ws-auth capability-token --ws-token-file <token-file>
```

Use `wss://` for non-loopback access.
