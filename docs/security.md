# Security

Codex Peer is a high-trust bridge. A message can cause the peer Codex to read files, run commands, or modify external systems within that peer's existing permissions.

## Required controls

- Bind `codex app-server` to loopback.
- Use app-server capability-token authentication.
- Use SSH forwarding or a TLS-protected `wss://` route for cross-host traffic.
- Require a token for every non-loopback peer.
- Use a unique random token for each host and rotate it after suspected exposure.
- Keep token files outside repositories and restrict file permissions.
- Run Codex under an account with only the permissions needed for intended tasks.
- Review the peer's configured tools and approval policy before allowing unattended work.

Do not expose app-server directly to the public internet. A reverse proxy is not sufficient unless it preserves authentication, restricts reachability, and provides valid TLS.

## Data handling

Codex Peer does not include token values in tool results. Peer URLs containing credentials, query parameters, or fragments are rejected.

Transcript recording is disabled by default. If `defaults.recordTranscripts` is set to `true`, Codex Peer writes JSONL metadata under `~/.codex-peer/runs/` or `CODEX_PEER_RUN_DIR`. Prompt and response bodies are omitted. On POSIX systems, the run directory is set to mode `0700` and files to `0600`.

The peer Codex and Codex app-server may maintain their own history or logs independently of this plugin.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or leaked credential. Use GitHub's private vulnerability reporting for this repository. Include reproduction steps without live tokens, personal paths, or private thread content.

Only the latest released Developer Preview version receives security fixes.
