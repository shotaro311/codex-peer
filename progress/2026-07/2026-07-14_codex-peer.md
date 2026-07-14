---
project_slug: codex-peer
date: 2026-07-14
updated: 2026-07-14
updated_by: codex
---

# 2026-07-14 Progress Log: codex-peer

## 概要

Codex PeerをOSSとして公開するため、配布形式、安全対策、公開ドキュメント、検証経路を整備し、GitHub repositoryと`v0.1.0` Releaseを公開した。

## 完了した作業

- `codex/oss-release-prep` ブランチと隔離worktreeを作成。
- MIT `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md` を追加。
- repository Marketplace metadataを追加。
- READMEとsetup / security / troubleshooting / app-server文書を汎用化。
- 個人環境専用のhostname、path、one-off handoff文書、ローカルinstallerを配布物から除外。
- esbuildでMCP serverを単一ESMへbundleし、`.mcp.json` をbundle参照へ変更。
- remote `wss://` のtoken必須化、URL credential拒否、token file permission確認を追加。
- 失敗 / 中断turnを成功扱いしない結果contractへ変更。
- transcriptをopt-in化し、記録内容をevent metadataだけに制限。
- MCP tool annotationにread / write / destructive / open-world性を明記。

## 検証

- `npm run check`: 成功、23 tests passed。
- `npm audit --omit=dev`: 0 vulnerabilities。
- plugin-creator validator: 成功。
- skill-creator quick validator: 成功。
- bundled MCP serverを`node_modules`のない一時directoryへcopyしてimport: 成功。
- bundled MCP serverのstdio handshakeと6 toolsのlist取得: 成功。
- Codex CLI 0.139.0でローカルMarketplace追加 / list: 成功。
- 旧private履歴を引き継がない単一root commitの `codex/public-v0.1.0` ブランチをローカル作成。
- 公開候補branchのarchiveを一時directoryへ展開し、`npm ci`、23 tests、audit、validator、gitleaksを再実行: 成功。
- Mac→Windowsのprojectless taskを公開候補コードで実行: `turnStatus=completed`, `turnSucceeded=true`。
- Windows→Macのreverse taskを実行。初回はMac側の旧Codex binaryで失敗し、LaunchAgentをChatGPT app同梱Codex 0.144.2へ更新後、再試行で`completed / true`を確認。

## 未実施

- 新しいCodex taskで公開版Skill / MCPが読み込まれることのUI確認。

## 公開結果

- Public repository: `https://github.com/shotaro311/codex-peer`
- Release: `https://github.com/shotaro311/codex-peer/releases/tag/v0.1.0`
- 旧private repositoryは`shotaro311/codex-peer-private-history`へ改名し、private / archivedで保持。
- GitHub security: private vulnerability reporting、secret scanning、push protection、Dependabot security updatesを有効化。
- Mac public install: version `0.1.0`、source ref `v0.1.0`、bundle hash一致、plugin / skill validator成功、installed bundleからWindows health成功。
- Windows public install: version `0.1.0`、source ref `v0.1.0`、bundle直接load成功、plugin / skill validator成功。

## リスク

- app-server WebSocket APIのexperimental互換性。
- peer Codexが持つ権限の範囲で外部変更が起こり得るため、`peer_message` はdestructive / open-worldとして扱う。
- 次回公開時もrepository内容と公開対象履歴のsecret scanを必須にする。

## 次

1. fresh Codex taskで公開版の表示を確認する。
2. app-server / plugin仕様変更を監視する。
3. 次回releaseでMac / Windowsの再インストールと双方向smokeを繰り返す。
