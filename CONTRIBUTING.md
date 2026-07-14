# Contributing

Codex Peer is a Developer Preview. Small, test-backed changes that preserve its security defaults are welcome.

## Local checks

```bash
npm ci
npm run check
npm audit --omit=dev
```

Change source files under `scripts/`, then rebuild and commit `dist/codex-peer-mcp.mjs`. The bundled file is required so marketplace users do not need a separate dependency installation step.

For plugin and skill validation, maintainers also run:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/codex-peer
```

## Pull requests

- Explain the user-facing behavior and security impact.
- Add regression tests for app-server protocol changes.
- Do not include tokens, personal hostnames, private thread content, or machine-specific paths.
- Keep transcript recording opt-in and content-free.
- Update setup or troubleshooting documentation when behavior changes.

Use private vulnerability reporting instead of a pull request for security-sensitive findings.
