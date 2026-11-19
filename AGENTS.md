# AGENTS.md — 運用ルール（下書き）

概要・構成は [PROJECT.md](PROJECT.md) を参照。2026-10-23に既存文書とコードから整理したリポジトリ固有の運用案。

## 作業の入口

[README.md](README.md)、[docs/setup-gemini-peer.md](docs/setup-gemini-peer.md)、[docs/completion-notifications.md](docs/completion-notifications.md)、[docs/security.md](docs/security.md)、[progress/progress.md](progress/progress.md)

## 開発・検証コマンド

- `npm run build`、`npm test`、`npm run validate`。まとめて `npm run check`。
- `npm test` は先にbundleを更新するため、distにも変更が出る。

## 守ること

- 依頼先・作業場所・権限を明示し、相手端末で利用できる機能を事前確認する。health成功を画面操作可能の証明にしない。
- 画面・ブラウザ作業の直列化、同一requestの重複抑止、親への1回通知を維持する。
- 送信結果不明やCLIエラーを新規依頼で自動再送しない。履歴に失敗を残し、未完了と成功を区別する。
- Windows watchdogは所有する専用app-serverだけをアイドル時に復旧する。対話中のCodexや他サービスを停止しない。

## 検証方法

- 設定・ACL・CLI失敗・同一会話・取消・重複通知を関連テストで確認する。
- 新規Peerタスクでツール発見を確認し、Mac/Windows実機とローカル履歴UIを分けて受入する。

コマンドは本下書き作成時には実行していない。実施した検証、失敗、未確認を分けて記録する。
