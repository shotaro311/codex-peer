# Troubleshooting

## Plugin is not visible

Run:

```bash
codex plugin marketplace list
codex plugin list
```

Confirm that marketplace `codex-peer` and plugin `codex-peer` are present, then restart Codex.

## Config not found

Create `~/.codex-peer/peers.json` or set `CODEX_PEER_CONFIG` to an absolute path.

## Remote peer requires authentication

Every non-loopback `wss://` peer must configure `authTokenEnv` or `authTokenFile`. Do not add a token to the URL.

## Token file permissions are too broad

On macOS or Linux:

```bash
chmod 600 ~/.codex-peer/*.token
```

On Windows, restrict the file ACL to the intended user and administrators.

## Non-loopback ws is refused

Plain WebSocket is allowed only for `localhost`, `127.0.0.1`, or `::1`. Use an SSH local forward or a valid `wss://` endpoint.

## Connection opens but initialize fails

Check that:

- the host is running a current `codex app-server`;
- the route preserves the `Authorization` header;
- the caller token matches the host token;
- the route forwards WebSocket upgrades, not only HTTP requests.

## Turn returns an empty response

Read `turnStatus`, `turnSucceeded`, and `turnError`. Empty `finalText` is not success evidence. A `failed` or `interrupted` turn returns `ok: false`.

## Turn is still running

Keep `threadId` and `turnId`, then use `peer_wait_until_complete`. The wait window does not cancel the peer task.

## macOS Computer Use native pipe fails

If the peer reports `Sky Computer Use native pipe startup failed`, first isolate whether the failure belongs to the Mac, the dedicated receiving app-server, or one peer thread.

1. Stop creating more GUI-capable peer threads and keep one receiving thread for sequential work.
2. Run a harmless Computer Use preflight from another local Codex session on the same Mac when available.
3. If the local preflight succeeds, do not change Accessibility or Screen Recording permissions yet. The capability is available and the failure is isolated to the receiver.
4. Inspect the dedicated receiver's uptime and helper-process count without printing credentials or sensitive process arguments.
5. With user authorization, restart only the dedicated receiving service. Do not quit an unrelated interactive Codex or ChatGPT app.
6. Confirm the receiver endpoint is healthy, its process changed, and stale helper processes are gone.
7. Run exactly one new read-only preflight. Continue the same healthy thread if it succeeds.
8. Check Accessibility and Screen Recording only when the clean preflight still fails or no local Codex session can use Computer Use.

Do not automatically retry non-idempotent actions such as sending a message. Require exact target and content readback, execute once, and stop if delivery is uncertain.
