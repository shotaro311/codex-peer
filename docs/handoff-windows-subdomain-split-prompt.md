# Windows Codex Prompt: Subdomain Split

You are running on the Windows PC. Configure the public routes so Apple Watch bridge and Codex Peer use separate hostnames.

## Goal

Use this split:

```text
codex-win.s-original.com       -> http://127.0.0.1:17842  # Apple Watch Windows bridge
codex-peer-win.s-original.com  -> http://127.0.0.1:17843  # Codex Peer app-server
```

Do not print token values.

## Steps

1. Update the repo:

```powershell
cd C:\Users\shotaro\code\shared\codex-peer
git pull
npm install
npm run check
```

2. Read:

```text
docs/windows-subdomain-split.md
```

3. Confirm local services:

```powershell
Invoke-RestMethod http://127.0.0.1:17842/
Invoke-WebRequest http://127.0.0.1:17843/healthz -UseBasicParsing
```

Expected:
- `17842` returns `codex-watch-bridge` JSON.
- `17843` returns `200 OK` for Codex app-server.

If app-server is currently occupying `17842`, stop that instance and keep app-server on `17843`.

4. Update the Windows Cloudflare Tunnel ingress to this shape:

```yaml
ingress:
  - hostname: codex-win.s-original.com
    service: http://127.0.0.1:17842
  - hostname: codex-peer-win.s-original.com
    service: http://127.0.0.1:17843
  - service: http_status:404
```

5. Ensure DNS routes exist:

```powershell
cloudflared tunnel route dns <WINDOWS_TUNNEL_ID_OR_NAME> codex-win.s-original.com
cloudflared tunnel route dns <WINDOWS_TUNNEL_ID_OR_NAME> codex-peer-win.s-original.com
```

6. Restart or reload the `cloudflared` Windows service.

7. Validate public routes:

```powershell
Resolve-DnsName codex-win.s-original.com
Resolve-DnsName codex-peer-win.s-original.com
Invoke-RestMethod https://codex-win.s-original.com/
Invoke-WebRequest https://codex-peer-win.s-original.com/healthz -UseBasicParsing
```

8. Verify token-authenticated WebSocket to:

```text
wss://codex-peer-win.s-original.com
```

## Report back

Reply with:

- Current commit hash
- `npm run check` result
- `cloudflared` service state
- Current tunnel ingress summary
- `codex-win.s-original.com` public health result
- `codex-peer-win.s-original.com` public health result
- Token-authenticated WebSocket result for `wss://codex-peer-win.s-original.com`
- Whether any app-server process is still listening on `17842`
- Any exact errors, with secrets redacted
