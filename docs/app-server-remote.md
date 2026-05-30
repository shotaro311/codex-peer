# App Server Remote Notes

Codex Peer talks to `codex app-server` using the app-server WebSocket protocol.

## Long turns

Long Codex work is normal. `peer_message` waits only briefly for a quick completion. If the peer is still working, it returns:

```json
{
  "ok": true,
  "turnCompleted": false,
  "threadId": "...",
  "turnId": "...",
  "transcriptPath": "..."
}
```

The caller should use `peer_wait` or `peer_read` later.

## Natural reports

The peer is not required to return a fixed `peerStatus`. The receiving Codex reads the natural-language report and decides whether to continue, ask the peer a follow-up, or report to the user.

## Token handling

Bearer tokens are read from environment variables. They are never included in returned JSON, warnings, transcripts, or error messages.
