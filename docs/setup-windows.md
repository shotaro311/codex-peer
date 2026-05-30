# Windows Setup

## 1. Install dependencies

```powershell
cd C:\Users\shotaro\code\shared\codex-peer
npm install
npm run check
```

## 2. Start Codex app-server

Create a token file outside the repo, then start app-server:

```powershell
codex app-server --listen ws://127.0.0.1:17843 --ws-auth capability-token --ws-token-file C:\Users\shotaro\.codex-peer\codex-peer.token
```

Current public route for the Windows peer is Cloudflare Tunnel:

```text
wss://codex-peer-win.s-original.com -> http://127.0.0.1:17843
```

Keep the Apple Watch Windows bridge on a separate hostname:

```text
https://codex-win.s-original.com -> http://127.0.0.1:17842
```

## 3. Reverse direction

For Windows Codex to call Mac Codex, add a Mac peer in `%USERPROFILE%\.codex-peer\peers.json` using the same shape:

```json
{
  "peers": {
    "mac": {
      "label": "Mac Codex",
      "url": "wss://codex-peer-mac.s-original.com",
      "authTokenEnv": "CODEX_PEER_MAC_TOKEN",
      "authTokenFile": "C:\\Users\\shotaro\\.codex-peer\\codex-peer.token",
      "defaultCwd": "/Users/shotaro/code",
      "platform": "macos"
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

補足:
- `wss://`: TLSありのWebSocket。公開経路ではこれを使う。
- `ws://127.0.0.1`: 同じPC内だけのWebSocket。token送信可。
- `http://127.0.0.1:17843`: Codex Peer用app-serverのorigin。WebSocket接続時はpublic側の`wss://`からupgradeされる。
- `http://127.0.0.1:17842`: Apple Watch Windows bridge用origin。
