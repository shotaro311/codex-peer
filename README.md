# Codex Peer

Codex Peer lets one Codex instance send a task to another Codex instance running on a different computer, then follow the resulting thread until it finishes.

It is aimed at people who actively use Codex on two or more machines and need symmetric host-to-host collaboration, including projectless tasks and work that depends on the peer computer's local environment.

> [!WARNING]
> Codex Peer is a Developer Preview. It uses the experimental Codex app-server WebSocket API, which may change without backward compatibility.

## When to use it

Use Codex's native remote features first when they cover the workflow. Codex Peer is useful when you need a separately running Codex on another computer to:

- start or continue a projectless task;
- inspect files, applications, or state that exist only on that computer;
- exchange natural-language task reports with the calling Codex;
- work in either direction, such as Mac to Windows and Windows to Mac.

Codex Peer does not provide remote desktop control. The peer Codex can only do what its own tools, permissions, and local environment allow.

## Install

Node.js 22 or later and the Codex CLI are required.

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

The repository contains a bundled MCP server, so plugin users do not need to run `npm install`.

Continue with [Setup](docs/setup.md). Keep the app-server on loopback unless you have a TLS-protected and authenticated network route.

## Tools

- `peer_health`: verifies the connection and app-server initialization.
- `peer_message`: starts or continues a peer task.
- `peer_wait`: checks one existing peer turn.
- `peer_wait_until_complete`: quietly follows a turn until it ends or the local wait window expires.
- `peer_threads`: lists threads on the peer.
- `peer_read`: reads recent turns from a peer thread.

A running turn returns `ok: true` and `turnCompleted: false`. A failed or interrupted turn returns `ok: false`, its `turnStatus`, and a sanitized `turnError`; an empty response is never treated as proof of success.

## Privacy defaults

- Remote `wss://` peers require a token.
- Plain `ws://` is accepted only for loopback addresses.
- Credentials, query parameters, and fragments are rejected in peer URLs.
- Transcript recording is disabled by default.
- When explicitly enabled, transcripts contain event metadata only, not prompts or responses.

Read [Security](docs/security.md) before exposing any route beyond localhost.

## Development

```bash
npm ci
npm run check
npm audit --omit=dev
```

`npm run check` rebuilds `dist/codex-peer-mcp.mjs`, runs the test suite, and validates the plugin layout.

## Status and scope

The initial release is intentionally small: remote app-server messaging, thread discovery, readback, and long-turn tracking. It does not include scheduled jobs, remote desktop, local LLM summarization, or a relay service.

See [Troubleshooting](docs/troubleshooting.md), [Contributing](CONTRIBUTING.md), the [MIT License](LICENSE), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Official references

- [Codex plugins](https://learn.chatgpt.com/docs/build-plugins.md)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server.md)
