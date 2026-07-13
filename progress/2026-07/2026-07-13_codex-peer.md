# 2026-07-13 codex-peer progress log

## 対象

- project slug: `codex-peer`
- project root: `C:\Users\shotaro\code\shared\codex-peer`

## 今日の変更

- progress 運用の入口を初期化。
- 欠落していた正本リポジトリをGitHubから再取得。
- Windows上で`import.meta.url`と`process.argv[1]`の比較が一致せずMCP serverの`main()`が起動しない原因を特定。
- entrypoint判定を`pathToFileURL()`で正規化し、Windows filesystem pathの回帰テストを追加。
- インストーラーで同一junctionを削除しないようにし、異なるリンクだけをlink本体として削除するよう修正。
- marketplace JSONをUTF-8 BOMなしで保存し、`codex plugin`の終了コードを検査するよう修正。
- `npm install`後、`npm run check`で16テストとPlugin検証を通過。
- cache内の`codex-peer-mcp.mjs`を直接起動し、MCP serverが即終了せずstdio待機へ入ることを確認後、手動停止。
- インストーラーで`C:\Users\shotaro\.codex\plugins\plugins\codex-peer`を正本へのjunctionとして復元し、Pluginを再インストール。
- Mac peer設定とtoken fileの存在を秘密値を読まずに確認。
- Mac peer公開経路のTCP 443疎通を確認。
- 現タスクのツール一覧は開始時に固定されており、再インストール後も`peer_health` / `peer_message`は追加されなかった。
- Codexアプリのtask一覧も接続中hostはWindows localのみで、Mac taskへ直接送信できなかった。
- standalone公開repoと`ai-plugins`履歴を確認し、2026-07-10以降のCodexPeer公開commitはない。2026-07-10にClaude Code(Fable 5)が変更した記録は`chatgpt-pro-orchestrator` 0.2.0だった。

## 最新状態

- 状態: Windows側接続基盤の修復は完了。新しいCodexタスクでMacへ依頼し、Mac側のPluginインストールとテストを継続する。

## 旧ログ / source

- 旧ログの有無と cleanup 分類は `progress/cleanup-candidates.md` で管理する。
- 正本 state / 根拠 artifact は、重複ログではない限り保持対象にする。

## 次回確認

- 新しいWindows Codexタスクで`peer_health`を実行する。
- Mac Codexへ`chatgpt-pro-orchestrator`の導入、installed/enabled確認、Skill可視性、unit testを依頼する。
- Mac側で利用できる版がWindowsの`0.3.0+codex.20260713152658`と一致するか確認する。
- `hono <=4.12.24`のaudit findingは利用経路への影響を評価してから更新判断する。

## 機密情報

- API key、token、`.env` 値、password、認証情報は記録しない。
