---
project_slug: codex-peer
updated: 2026-07-14
updated_by: codex
status: release_preparation
---

# Project Progress: codex-peer

## 概要

- Codex Peer は、別PCで動く Codex app-server に自然文の依頼を送り、thread / turn を追跡する Developer Preview プラグイン。
- 主な対象は、複数PCのCodexを使うユーザーの双方向連携、プロジェクトなしタスク、相手PC固有の環境確認。
- Codex標準のremote機能で成立する場合は標準機能を優先し、ホスト間の対称連携が必要な場合にCodex Peerを使う。

## 最新の検証済み状態

- 公開準備は隔離worktreeの `codex/oss-release-prep` ブランチで実施中。
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

## 進行中

- README、汎用setup、security、troubleshooting、contributing、Marketplace metadataを公開用に整理。
- 既存の個人環境専用runbookとone-off handoff文書はOSS配布物から除外。

## 次アクション

- 公開直前にリポジトリ内容と履歴のsecret scanを行う。
- GitHubのprivate vulnerability reportingを有効化する。
- ユーザー確認後にrepositoryをpublic化し、`v0.1.0` tag / releaseを作成する。
- `codex/public-v0.1.0` を公開先のmainとして反映し、Git URLからMarketplace追加とplugin installを再検証する。

## Blocker / Risk

- Codex app-server WebSocket APIはexperimentalで、互換性が変わる可能性がある。
- repositoryは現時点でprivate。public化、tag、releaseはまだ実施していない。
- GitHub Marketplaceの公開URLからのinstallはpublic化後にのみ検証できる。
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
