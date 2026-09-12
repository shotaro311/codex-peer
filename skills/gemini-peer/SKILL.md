---
name: gemini-peer
description: Delegate consultation, review, file editing, and tests to Gemini 3.8 Flash through the official Antigravity CLI using configured Codex Peer tools on Mac or Windows.
---

# Gemini Peer

Use the configured Gemini receiver with the existing `peer_*` tools. Select the peer on the host containing the required files. See [setup and verification](../../docs/setup-gemini-peer.md) when the receiver is not configured.

1. Run `peer_health` once if connectivity is unknown. Health verifies only the receiver connection; it does not establish login, subscription quota, model availability, or local capabilities.
2. Give Gemini a concise task packet: objective, permitted files and commands, constraints, and evidence required for completion. Do not transfer credentials or full conversation history.
3. For consultation or review, use `executionMode: "read-only"`. This selects Antigravity's plan mode, an agent instruction mode, not OS-enforced filesystem protection. If strict protection is required, provide sanitized text or a separately protected copy.
4. For authorized edits/tests, use `executionMode: "workspace-write"` and an explicit `cwd`. When Codex is also editing the project, prepare a separate worktree and assign file ownership. Antigravity uses scoped local permissions; directory discovery may require `read_file(<exact-workspace-root>)`, and tests need their specific command allowed. Grant only access already included in the delegation; the adapter never supplies a global permission bypass. A reported `list_dir (requires read_file)` is a scoped read-permission blocker, not evidence that the model or connection failed.
5. Set `notifyParent: true` when the shared completion bridge is configured; omit `waitForCompletion`. The bridge uses the calling task ID from `CODEX_THREAD_ID`, or an explicit matching `parentThreadId`. Preserve the returned `runId`; after its completion notice, read the saved result once with `peer_job`. A disconnected caller or expired wait does not cancel Gemini. Do not resend the task or repeatedly wake the parent to check progress. If notifications are unavailable, report that limitation and use one quiet programmatic wait rather than model-driven polling.
6. Follow up using the same `threadId`. The adapter resumes its saved Antigravity conversation. Do not guess a conversation ID or use `--continue` to select whichever session happens to be newest.
7. Check `turnSucceeded`, errors, the response, and actual changes/tests. `SUCCESS` means the CLI produced a response; it does not establish task completion. Permission denial can occur with exit code zero. The adapter flags observed denial/tool errors conservatively; the parent still verifies acceptance evidence.

Gemini 3.8 Flash medium/high is fixed by receiver configuration. Do not switch to another model, API key, paid API route, or additional credits when quota/login/model selection fails. Authentication uses the official CLI and OS credential storage. A login that requires a password, passkey, or MFA the agent cannot complete needs the user's participation.

Treat `failed` and `interrupted` as terminal failures. After a crash or uncertain delivery, inspect saved state and file changes before deciding whether another instruction is safe. The receiver never automatically resends a task.
