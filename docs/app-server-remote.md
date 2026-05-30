# App Server Remote Notes

Codex Peer talks to `codex app-server` using the app-server WebSocket protocol.

## Long turns

Long Codex work is normal. By default, `peer_message` waits only briefly for a quick completion. If the peer is still working, it returns:

```json
{
  "ok": true,
  "turnCompleted": false,
  "threadId": "...",
  "turnId": "...",
  "transcriptPath": "..."
}
```

For user-facing checks where the caller should not keep reporting unchanged progress, call `peer_message` with `waitForCompletion: true`, or use `peer_wait_until_complete` with the returned `threadId` and `turnId`.

`waitWindowSeconds` is a local quiet wait window, not a task timeout. If the window ends while the peer is still running, the tool returns `turnCompleted: false` and the same `threadId` / `turnId` can be followed again later.

Use `peer_wait` or `peer_read` when the caller needs only a short snapshot instead of quiet completion tracking.

## Natural reports

The peer is not required to return a fixed `peerStatus`. The receiving Codex reads the natural-language report and decides whether to continue, ask the peer a follow-up, or report to the user.

## Token handling

Bearer tokens are read from environment variables first, then token files when `authTokenFile` is configured. They are never included in returned JSON, warnings, transcripts, or error messages.
