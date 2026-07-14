---
project_slug: codex-peer
updated: 2026-07-14
updated_by: codex
status: released
---

# Project Progress: codex-peer

## 概要

- Codex Peer は、別PCで動く Codex app-server に自然文の依頼を送り、thread / turn を追跡する Developer Preview プラグイン。
- 主な対象は、複数PCのCodexを使うユーザーの双方向連携、プロジェクトなしタスク、相手PC固有の環境確認。
- Codex標準のremote機能で成立する場合は標準機能を優先し、ホスト間の対称連携が必要な場合にCodex Peerを使う。

## 最新の検証済み状態

- 公開作業は隔離worktreeの `codex/oss-release-prep` ブランチで実施した。
- MCP本体を `dist/codex-peer-mcp.mjs` にbundleし、利用者側の `npm install` を不要にした。
- 外部 `wss://` 接続はtoken必須、非loopback `ws://` は拒否、URL内credential / query / fragmentも拒否する。
- peer turnの `completed` / `failed` / `interrupted` を分離し、失敗turnは `ok: false` として返す。
- transcriptは既定で無効。有効時もprompt / response本文を保存せず、metadataだけを保存する。
- unit test 23件、npm production dependency audit、plugin validator、skill validatorが成功。
- Codex CLI 0.139.0がローカルMarketplaceとして認識できることを隔離確認した。
- bundled MCP serverのstdio初期化とtool list取得に成功した。
- 旧private履歴を含まない単一root commitの `codex/public-v0.1.0` ブランチをローカル作成した。
- 公開候補branchを一時directoryへ展開し、`npm ci` から全検証を再実行して成功した。
- Mac→Windowsのprojectless taskを公開候補コードで実行し、`completed / true`を確認した。
- Windows→Macのprojectless taskも`completed / true`を確認した。Mac app-serverは旧Codex実行ファイルからChatGPT app同梱`codex-peer/0.144.2`へ更新した。
- 公開repo `https://github.com/shotaro311/codex-peer` を旧private履歴とは別のrepository IDで作成し、クリーンなroot commitだけを公開した。
- `v0.1.0` tag / GitHub Releaseを公開し、Marketplace sourceを`v0.1.0`へ固定した。
- GitHub private vulnerability reporting、secret scanning、push protection、Dependabot security updatesを有効化した。
- 公開MarketplaceからMac / Windowsの両方へ`codex-peer@codex-peer`をインストールし、version、bundle、validator、source refをreadbackした。

## 公開状態

- Repository: `https://github.com/shotaro311/codex-peer`
- Release: `https://github.com/shotaro311/codex-peer/releases/tag/v0.1.0`
- 旧履歴: private / archivedの`shotaro311/codex-peer-private-history`とlocal git bundleで保持。
- Mac installed cache: public Marketplace版`0.1.0`、bundle hash一致、6 tools / Windows health成功。
- Windows installed cache: public Marketplace版`0.1.0`、bundle直接load、plugin / skill validator成功。

## 次アクション

- 新しいCodex taskで公開版Skill / MCPの表示を確認する。
- issue / vulnerability report / app-server互換性変更を監視する。
- 次回リリースではversion bump、tag固定、Mac / Windows再インストール、fresh task確認を同じ順で行う。

## Blocker / Risk

- Codex app-server WebSocket APIはexperimentalで、互換性が変わる可能性があるため、Codex更新時は双方向smoke testを再実行する。
- token値、private hostname、個人path、private thread本文をrepositoryやprogressへ入れない。

## 重要パス

- `README.md`
- `docs/setup.md`
- `docs/security.md`
- `docs/troubleshooting.md`
- `.agents/plugins/marketplace.json`
- `scripts/codex-peer-mcp.mjs`
- `dist/codex-peer-mcp.mjs`

## 詳細ログ

- [2026-07-14](2026-07/2026-07-14_codex-peer.md)
