# Changelog

## 0.1.2 - 2026-07-29

### Added

- A recovery runbook for macOS `Sky Computer Use native pipe startup failed` errors.
- Isolation checks that distinguish peer receiver state from system-wide Computer Use permissions.
- Guidance to restart only a dedicated receiving app-server service after user authorization.
- Single-thread and exactly-once safeguards for GUI and message-sending tasks.

### Clarified

- Accessibility and Screen Recording checks come after a clean receiver restart and one read-only preflight, not as the first diagnosis.
- A healthy local Computer Use preflight is evidence that the capability and macOS permissions are available.

This release changes delegation and recovery guidance only. It does not change the MCP tool API or network protocol.

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
