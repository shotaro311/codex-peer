# Setup

Each direction has two roles:

- **Host:** runs `codex app-server` on the computer that will receive work.
- **Caller:** runs the Codex Peer plugin and connects to the host.

For bidirectional use, configure each computer once as a host and once as a caller. Use a different token for each host.

## 1. Install the plugin on the caller

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

Restart Codex after installation if the plugin is not visible immediately.

## 2. Create a host token

Store tokens outside the repository. Do not paste them into prompts, issues, screenshots, or configuration JSON.

macOS or Linux:

```bash
mkdir -p ~/.codex-peer
umask 077
openssl rand -hex 32 > ~/.codex-peer/host.token
chmod 600 ~/.codex-peer/host.token
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex-peer" | Out-Null
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower() | Set-Content -NoNewline "$env:USERPROFILE\.codex-peer\host.token"
```

Restrict the Windows token file so only the intended user and administrators can read it.

## 3. Start app-server on the host

Keep the listener on loopback:

macOS or Linux:

```bash
codex app-server \
  --listen ws://127.0.0.1:4500 \
  --ws-auth capability-token \
  --ws-token-file ~/.codex-peer/host.token
```

Windows PowerShell:

```powershell
codex app-server --listen ws://127.0.0.1:4500 --ws-auth capability-token --ws-token-file "$env:USERPROFILE\.codex-peer\host.token"
```

Run this as a supervised background process only after interactive setup works.

## 4. Create a network route

### Option A: SSH local forwarding

From the caller, forward a local port to the host loopback listener:

```bash
ssh -N -L 4501:127.0.0.1:4500 user@peer-host
```

The caller will use `ws://127.0.0.1:4501`. This is treated as loopback by Codex Peer, while the app-server still verifies its token.

### Option B: authenticated WSS route

A private overlay or reverse proxy may expose the loopback listener as `wss://peer.example.com`. The route must:

- terminate TLS with a valid certificate;
- preserve the `Authorization` header;
- restrict who can reach the endpoint;
- avoid putting tokens in URLs or query parameters.

Do not expose a plain `ws://` listener to a LAN or the public internet.

## 5. Configure the caller

Copy the host token to the caller through a trusted channel, then store it with restrictive permissions. Set `CODEX_PEER_CONFIG` or create `~/.codex-peer/peers.json`.

SSH-forwarded example:

```json
{
  "peers": {
    "windows": {
      "label": "Windows Codex",
      "url": "ws://127.0.0.1:4501",
      "authTokenFile": "~/.codex-peer/windows.token",
      "platform": "windows"
    }
  },
  "defaults": {
    "maxResponseChars": 8000,
    "progressCheckAfterTurns": 5,
    "waitWindowSeconds": 7200,
    "pollIntervalSeconds": 15,
    "recordTranscripts": false
  }
}
```

WSS example:

```json
{
  "peers": {
    "mac": {
      "label": "Mac Codex",
      "url": "wss://peer.example.com",
      "authTokenEnv": "CODEX_PEER_MAC_TOKEN",
      "platform": "macos"
    }
  }
}
```

`authTokenEnv` takes precedence over `authTokenFile`. For projectless tasks, omit `defaultCwd` and start a new thread. Add `defaultCwd` only when the peer should normally begin in a particular directory.

## 6. Verify

Ask Codex to run `peer_health` for the configured peer. Then send a harmless task such as asking for the peer operating system and verify that the returned `turnStatus` is `completed`.

If it fails, use [Troubleshooting](troubleshooting.md).
