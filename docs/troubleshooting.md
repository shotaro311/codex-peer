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
