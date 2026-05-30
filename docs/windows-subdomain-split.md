# Windows Subdomain Split

Use separate public hostnames for the Apple Watch bridge and Codex Peer.

```text
codex-win.s-original.com       -> http://127.0.0.1:17842
codex-peer-win.s-original.com  -> http://127.0.0.1:17843
```

## Expected local services

Apple Watch Windows bridge:

```text
http://127.0.0.1:17842
```

Codex app-server for Codex Peer:

```powershell
codex app-server --listen ws://127.0.0.1:17843 --ws-auth capability-token --ws-token-file C:\Users\shotaro\.codex-peer\codex-peer.token
```

## Cloudflare Tunnel ingress

Use one Windows `cloudflared` service, with separate hostnames:

```yaml
ingress:
  - hostname: codex-win.s-original.com
    service: http://127.0.0.1:17842
  - hostname: codex-peer-win.s-original.com
    service: http://127.0.0.1:17843
  - service: http_status:404
```

Create or update DNS routes for both hostnames:

```powershell
cloudflared tunnel route dns <WINDOWS_TUNNEL_ID_OR_NAME> codex-win.s-original.com
cloudflared tunnel route dns <WINDOWS_TUNNEL_ID_OR_NAME> codex-peer-win.s-original.com
```

## Acceptance checks

```powershell
Invoke-RestMethod https://codex-win.s-original.com/
Invoke-WebRequest https://codex-peer-win.s-original.com/healthz -UseBasicParsing
```

Then verify a token-authenticated WebSocket connection to:

```text
wss://codex-peer-win.s-original.com
```

Do not print the token value in logs or reports.

補足:
- `codex-win.s-original.com`: Apple Watch用Windows bridge専用。
- `codex-peer-win.s-original.com`: Mac/Windows Codex Peer用app-server専用。
