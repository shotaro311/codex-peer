# codex-peer progress

このファイルは、この project root の進捗共有入口です。実行ロジック、品質判断、公開判断の正本ではありません。

## 最新状態

- 状態: Windows固有のMCP起動判定と再インストーラーを修正し、16テスト、Plugin検証、cache反映まで完了。Mac公開経路は疎通するが、現タスクはMCPツールを起動時に読み込むためMac実機依頼は未完了
- 最終更新: 2026-07-13
- 最新ログ: [2026-07/2026-07-13_codex-peer.md](2026-07/2026-07-13_codex-peer.md)

## cleanup

- 削除候補: [cleanup-candidates.md](cleanup-candidates.md)
- 移行検証後は、coverage 済みの重複進捗ログだけをごみ箱へ移動する。
- 正本 state / 根拠 artifact は、重複ログではない限り保持対象にする。

## 2026-07-13 更新

- 欠落していた正本を`C:\Users\shotaro\code\shared\codex-peer`へ再取得。
- Windows pathを`pathToFileURL()`で正規化し、MCP entrypointが実行されない不具合を修正。
- 再インストーラーで既存junctionを安全に再利用し、marketplace JSONをUTF-8 BOMなしで保存し、Codex CLI終了コードを検査するよう修正。
- `npm run check`で16テストとPlugin検証を通過。
- インストール済みcacheのMCP entrypointを直接起動し、即終了せずstdio待機へ入ることを確認。
- `shotaro-local`マーケットプレイスの実体を正本へのjunctionへ修復し、`codex-peer 0.1.0`をinstalled/enabledで確認。
- Mac peer設定、token fileの存在、`codex-peer-mac.s-original.com:443`の疎通を値非表示で確認。
- `npm audit --omit=dev`はtransitive dependency `hono <=4.12.24`のhigh 1件を報告。自動fixは未実施。
- 2026-07-10以降の公開commitはなく、最新公開commitは2026-05-31。Claude Code(Fable 5)の2026-07-10作業ログはCodexPeerではなく`chatgpt-pro-orchestrator`を対象としていた。

## 進め方

- 実作業開始時はこのファイルを読む。
- 作業終了時は日別ログを更新し、このファイルに最新状態を反映する。
- 調査だけ、レビューだけ、変更禁止の依頼では新規ログを増やさない。

## 旧ログ / 参照元

- 既存の `task/`、`handoff.md`、status / report 系ログは、移行完了まで `progress/` からリンクする。
- `run_state.json`、`workflow-state.json`、`publish-summary.md`、receipt / journal / DB / build artifact は、重複ログではない限り保持対象にする。
- 見つかった旧ログは、内容を断定せず日別ログからリンクする。

## 機密情報

- API key、token、`.env` 値、password、認証情報はここに書かない。
