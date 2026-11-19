# Codex Peer — WindowsのGemini連携作業先

2026-10-23にローカルのコード・設定・既存文書を確認して作成した下書き。以下のコマンドは今回未実行で、過去の検証記録と現在の稼働は区別する。

## 目的

Codex間の端末連携とGeminiへの依頼・完了通知・履歴表示を提供するCodex PeerのWindows作業先。独立した名前の製品ではなく `shotaro311/codex-peer` のcheckout。

## 構成

| 場所 | 内容 |
|---|---|
| `scripts/codex-peer-mcp.mjs` | Codex Peer MCP |
| `scripts/gemini-peer-server.mjs` | Antigravity CLI経由のGemini実行 |
| `scripts/peer-completion-jobs.mjs` | 完了追跡 |
| `scripts/peer-completion-delivery.mjs` | 親への通知 |
| `dist/` | 配布用bundle |
| `skills/` | 利用手順 |
| `docs/` | 導入・権限・通知・履歴の説明 |

## 利用・開発の入口

- Node.js 22以上。package.jsonのbuildでbundleを生成する。
- Gemini履歴画面は文書上 `http://127.0.0.1:17848/history`。既定状態ディレクトリはコード上 `~/.gemini-peer`。
- 相手端末の操作機能・認証・ブラウザは相手側で確認し、元端末から自動継承されたと扱わない。

## 確認できた状態

- 2026-09-16の進捗にはWindowsのCLIエラー分類と本番反映の記録がある。ソース・distに既存未コミット変更がある。

## 要確認

- 本流mainへの統合、公開版とこの作業先の一致、現在の通知・同一会話継続・履歴画面の受入状態は要確認。

## 参照

[README.md](README.md)、[docs/setup-gemini-peer.md](docs/setup-gemini-peer.md)、[docs/completion-notifications.md](docs/completion-notifications.md)、[docs/security.md](docs/security.md)、[progress/progress.md](progress/progress.md)
