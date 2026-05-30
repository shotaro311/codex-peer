# Windows Codex Prompt: Enable Reverse Peer

You are running on the Windows PC in the existing Codex Peer setup thread.

Your task is to make Windows Codex able to call Mac Codex through the same `codex-peer` plugin.

Do not print token values.

## Current Mac endpoint

```text
wss://codex-peer-mac.s-original.com -> Mac app-server on 127.0.0.1:17845
```

Mac-side public health and token-authenticated `initialize` have already passed from the Mac side.

Use the existing Windows token file for the Mac peer:

```text
C:\Users\shotaro\.codex-peer\codex-peer.token
```

The Mac app-server uses the same token value, so no new secret needs to be transferred in this thread.

## Steps

1. Update the repo and validate:

```powershell
cd C:\Users\shotaro\code\shared\codex-peer
git pull
npm install
npm run check
```

2. Create or update `%USERPROFILE%\.codex-peer\peers.json` so it includes both peers:

```json
{
  "peers": {
    "windows": {
      "label": "Windows Codex",
      "url": "wss://codex-peer-win.s-original.com",
      "authTokenFile": "C:\\Users\\shotaro\\.codex-peer\\codex-peer.token",
      "defaultCwd": "C:\\Users\\shotaro\\code",
      "platform": "windows"
    },
    "mac": {
      "label": "Mac Codex",
      "url": "wss://codex-peer-mac.s-original.com",
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

3. Install or refresh the local plugin if the current Windows Codex supports plugin CLI:

```powershell
.\scripts\windows\install-codex-peer-plugin.ps1
codex plugin list
```

If the installed `codex` command does not support `plugin add`, report that and continue with direct MCP-script verification below. The script still prepares the local marketplace file and junction.

4. Verify Windows can connect to Mac:

```powershell
node --input-type=module -e "import { callPeerHealth, loadPeerConfig } from './scripts/codex-peer-mcp.mjs'; const r = await callPeerHealth(loadPeerConfig(), { peerId: 'mac' }); console.log(JSON.stringify({ ok: r.ok, platformOs: r.platformOs, codexHome: r.codexHome, peerId: r.peerId }, null, 2));"
```

Expected:

```json
{
  "ok": true,
  "platformOs": "macos"
}
```

5. Send one test message from Windows Codex to Mac Codex:

```powershell
node --input-type=module -e "import { callPeerMessage, loadPeerConfig } from './scripts/codex-peer-mcp.mjs'; const r = await callPeerMessage(loadPeerConfig(), { peerId: 'mac', message: '私はWindowsのCodexです。これはMacへのテスト送信です。', startNewThread: true, waitForCompletion: true, waitWindowSeconds: 120 }); console.log(JSON.stringify({ ok: r.ok, threadId: r.threadId, turnId: r.turnId, turnCompleted: r.turnCompleted, finalText: r.finalText, latestText: r.latestText, transcriptPath: r.transcriptPath, warnings: r.warnings }, null, 2));"
```

If `turnCompleted` is `false`, run:

```powershell
node --input-type=module -e "import { callPeerWaitUntilComplete, loadPeerConfig } from './scripts/codex-peer-mcp.mjs'; const r = await callPeerWaitUntilComplete(loadPeerConfig(), { peerId: 'mac', threadId: '<threadId>', turnId: '<turnId>', waitWindowSeconds: 120 }); console.log(JSON.stringify({ ok: r.ok, threadId: r.threadId, turnId: r.turnId, turnCompleted: r.turnCompleted, finalText: r.finalText, latestText: r.latestText, transcriptPath: r.transcriptPath, warnings: r.warnings }, null, 2));"
```

## Report back

Reply with:

- Current commit hash
- `npm run check` result
- `scripts/windows/install-codex-peer-plugin.ps1` output
- Whether `codex plugin add` succeeded
- Windows `%USERPROFILE%\.codex-peer\peers.json` peer IDs
- `peer_health` result for `mac`
- test `peer_message` / `peer_wait_until_complete` result for `mac`
- Any exact errors, with secrets redacted
