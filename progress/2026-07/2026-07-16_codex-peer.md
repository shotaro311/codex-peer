---
project_slug: codex-peer
date: 2026-07-16
updated: 2026-07-16
updated_by: codex
---

# 2026-07-16 Progress Log: codex-peer

## 概要

公開repositoryのREADMEを日本語に対応し、非エンジニアでも用途、導入条件、安全上の注意、現在の制限を理解できる構成へ更新した。

## 完了した作業

- 入口を`README.md`の1ファイルに保ち、日本語を先頭、既存英語版を後半へ配置した。
- Codex Peerを「別のパソコンで動くCodex同士の連絡係」として平易に説明した。
- MacとWindowsの双方向依頼、projectless task、相手側固有環境の確認例を追加した。
- Codex公式remote機能を優先する条件と、Codex Peerが向く条件を分けて記載した。
- リモートデスクトップではないこと、相手側の権限を超えられないことを明記した。
- ワンクリック導入ではなく、Codex CLI、Node.js 22以降、SSH転送または認証付きWSS、初回のターミナル設定が必要であることを明記した。
- 認証トークン、app-server公開範囲、会話記録の既定値に関する安全上の注意を追加した。
- 提供中の6 toolsを日本語で説明した。
- Claude CodeからCodexへ依頼できる用途を追加した。
- Claude Codeへ導入する場合は、Codex向けコマンドを流用せず、Claude Code公式のPluginまたはMCP仕様へ合わせる注意書きを追加した。
- 非エンジニア向けに、CodexまたはClaude Codeへrepository URLを渡して環境確認から導入・接続テストまで依頼する方法と、コピー用の依頼文を追加した。
- AIへ導入を任せる場合もtokenを会話へ貼らず、router / firewall / external service変更を事前確認する注意を追加した。

## リリース判断

- 今回はREADMEだけの変更で、plugin code、manifest、Marketplace source、配布bundleに変更はない。
- 既存の`v0.1.0` tagは動かさず、repositoryの`main`だけを更新する。

## 検証

- `npm run check`
- `npm audit --omit=dev`
- plugin validator
- skill validator
- Markdown内のローカルリンク確認
- `git diff --check`
- Claude Code公式のPlugin / MCP資料とREADME記載内容の照合

## 次

1. 利用者から導入時につまずく箇所を収集し、必要に応じて日本語setup guideを追加する。
2. app-server / plugin仕様変更を監視する。
