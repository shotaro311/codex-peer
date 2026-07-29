# Changelog

## 0.1.1 - 2026-07-29

### Added

- Capability-aware delegation guidance for Computer Use, Browser Use, and attached browser extensions.
- Host routing rules so GUI and authenticated browser work runs on the computer that owns the target application or session.
- Harmless read-only preflight checks before capability-dependent work.
- Fresh-thread guidance after installing or updating peer-local tools, skills, or plugins.

### Clarified

- `peer_health` verifies the peer app-server connection, not the availability of peer-local GUI or browser capabilities.
- Codex Peer does not transfer the caller's tools, browser state, cookies, permissions, or desktop access to the peer.
- Capability-specific failures should not be reported as generic Codex Peer connection failures.

### Security

- Refreshed locked dependencies to versions with no findings from `npm audit --omit=dev`.

This release changes delegation guidance only. It does not change the MCP tool API or network protocol.
