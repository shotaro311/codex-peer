# codex-peer cleanup candidates

このファイルは、progress coverage 後に重複進捗ログをごみ箱へ移動できるかを管理するための表です。実行ロジック、品質判断、公開判断の正本ではありません。

## 運用ルール

- 移行完了までは、旧ログは `progress/` からリンクする。
- coverage 検証後、progress に必要情報が反映済みの重複進捗ログだけを削除対象にする。
- cleanup 実施時は恒久削除ではなく、ごみ箱へ移動する。
- 正本 state / 根拠 artifact は、重複ログではない限り保持対象にする。
- API key、token、`.env` 値、password、認証情報は記録しない。

## 削除対象（coverage 検証後）

- なし

## 保持対象（正本 / 根拠）

- `run_state.json`、`workflow-state.json`、`publish-summary.md`
- receipt / journal / DB / build artifact
- 現行 runbook、source code

## 要確認

- 旧 `task/`、`handoff.md`、status / report 系ログの coverage 状況

## 実施ログ

- 2026-07-13: `codex-peer` の cleanup 判断表を初期化。
