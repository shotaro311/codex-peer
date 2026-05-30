# Mac Host Setup

This setup lets Windows Codex call Mac Codex through Codex Peer.

## Public route

```text
wss://codex-peer-mac.s-original.com -> http://127.0.0.1:17845
```

## Local app-server

Mac runs Codex app-server with a token file:

```bash
/Applications/Codex.app/Contents/Resources/codex app-server \
  --listen ws://127.0.0.1:17845 \
  --ws-auth capability-token \
  --ws-token-file /Users/shotaro/.codex-peer/mac.token
```

The current Mac setup uses the same Codex Peer token value already stored on Windows at:

```text
C:\Users\shotaro\.codex-peer\codex-peer.token
```

This avoids sending a new secret through a Codex thread.

## Health checks

```bash
curl -I http://127.0.0.1:17845/healthz
curl -I https://codex-peer-mac.s-original.com/healthz
```

補足:
- `codex-peer-mac.s-original.com`: Windows CodexからMac Codexへ接続する公開URL。
- `17845`: Mac側Codex Peer app-server用のローカルポート。
