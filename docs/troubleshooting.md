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

## Computer Use native pipe fails on macOS or Windows

If the peer reports `Sky Computer Use native pipe startup failed`, first isolate whether the failure belongs to the Mac, the dedicated receiving app-server, or one peer thread.

1. Stop creating more GUI-capable peer threads and keep one receiving thread for sequential work.
2. Use `peer_capability_message` so another caller process cannot start the same peer-local capability concurrently.
3. Run a harmless Computer Use preflight from another local Codex session on the same host when available.
4. If the local preflight succeeds, do not change OS permissions yet. The capability is available and the failure is isolated to the receiver.
5. Run the configured watchdog once. It will defer recovery while a peer connection is active.
6. Confirm the receiver endpoint is healthy, its process changed when recovery was required, and stale helper processes are gone.
7. Run exactly one new read-only preflight. Continue the same healthy thread if it succeeds.
8. Check OS permissions only when the clean preflight still fails or no local Codex session can use Computer Use.

Do not automatically retry non-idempotent actions such as sending a message. Require exact target and content readback, execute once, and stop if delivery is uncertain.

## Capability task reports busy

`peer_capability_message` found an existing lock for the same peer and capability. Do not bypass it with `peer_message`.

- If the returned turn is still running, wait with `peer_wait_until_complete` and pass the same `capability`.
- If the caller stopped unexpectedly, the lock expires after four hours.
- A terminal wait releases the matching lock automatically.

## Watchdog defers recovery

- `detail: active-connections`: a caller is connected, so recovery would interrupt work.
- `detail: cooldown`: a restart already happened within the configured cooldown.
- `action: check-only`: the check detected a recovery condition but was explicitly told not to change state.

On Windows, a command-mismatch error is a safety stop. Verify the configured port and `expectedCommandFragments`; never weaken them to a generic `codex.exe` match.
