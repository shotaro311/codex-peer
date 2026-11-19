# 完了通知

`peer_message` と `peer_capability_message` に `notifyParent: true` を渡すと、親ホストの専用プログラムが子の完了イベントを受信し、結果を保存してから `codex queue` へ通知を1回送ります。親AIは監視しません。親と子が異なるOSでも、通知の保存・キュー投入は親ホストで行います。

## 既存の呼び出しからの変更

以前は `peer_message({peerId, message, waitForCompletion: true})` が接続を保持し、待機窓を超えた後は親が再び待機ツールを呼んでいました。新方式は `peer_message({peerId, message, notifyParent: true, parentThreadId})` がすぐに `runId` と `receiptPath` を返します。以後の `peer_wait*` 呼び出しは不要です。

通知を受け取った親は `peer_job({runId})` で保存結果を読み、実際のファイル・テストを別途確認します。通知はツール由来の固定文と結果の参照先だけで、子の自由文や新しい承認を含みません。`completed` は1ターンの終了で、依頼全体の完成ではありません。

## 設定

親の `~/.codex-peer/peers.json` に次のキーを追加します。既存の `peers` と `defaults` はそのままです。

```json
{
  "completion": {
    "enabled": true,
    "codexBin": "/absolute/path/to/native/codex"
  }
}
```

Windowsは実体の `codex.exe` を指定します。npmの `.cmd` shimは使いません。送信先は呼び出し元の `CODEX_THREAD_ID`、または明示した `parentThreadId` です。環境に呼び出し元IDがある場合、別のタスクIDへの送信は拒否します。通知と同期待機は併用できません。

設定がない既存利用者は従来動作を維持します。`notifyParent: false` で従来の同期呼び出しを明示できます。新設定は追加のみなので、`completion.enabled` をオフにすれば旧方式に戻せます。既に動いている子や保存済み結果は取り消しません。

## 保存形式と障害時

正本は親ホストの `~/.codex-peer/jobs/<runId>.json`（schemaVersion 1）です。UUIDは実行・親・子の識別子、日時はUTCのISO 8601、未確定値はnullまたは未作成フィールドです。登録直後だけ依頼本文を保存し、子のターンID取得後に本文を消します。認証トークンは保存せず、既存設定ファイルのパスを参照します。ディレクトリは所有ユーザー用、ファイルは0600で作成します（WindowsではユーザーACLも導入時に確認）。

実行状態は `registered → starting → sending → running → completed/attention`。送信前に `sending` を保存するため、応答喪失時にも同じ仕事を自動で再送しません。通知状態は `pending → sending → queued/failed/uncertain`、通知試行は最大1回です。キュー応答が不明な場合も自動再送しません。厳密なexactly-once配送保証ではありません。

プロセスが異常終了した場合、`peer_job` は `worker_unavailable` を返します。実行ID・子のタスクIDを確認して回収し、新規依頼として再送しないでください。24時間の接続待機上限、接続エラー、子の失敗も一度だけ親へ要確認通知を送ります。

終了結果が保存済みで通知が`pending`のまま、かつ元の実行プロセスが終了している場合だけ、`node dist/codex-peer-mcp.mjs --completion-job /absolute/path/to/receipt.json`で通知部分を回収できます。子の作業は再実行しません。全通知経路で永久の`.delivery-attempt`ファイルを排他的に作成し、既存なら送信しません。配送が不明な場合、このファイルを削除して再試行しないでください。登録JSONは256KiB、実行記録は512KiBが上限です。大きな返答は要約せず切り詰め、元の子タスクを参照します。

親が実行中ならキューに保存し、通常終了後に受け取ります。親タスクが未ロード、アプリ終了中、または明示的に中断された状態では即時の再開は保証しません。Codex内部にはプログラムによるキュー確認がありますが、定期的な親AIの推論はありません。

## 一次情報

- [OpenAI app-server lifecycle](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)
- [OpenAI queue CLI](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/tui/src/session_queue_commands.rs)
- [OpenAI queue service](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/ext/queue/src/service.rs)
- [Antigravity CLI headless](https://antigravity.google/docs/cli/headless/)

受入条件: 実行中の親AI監視0回、子への依頼1回、通知試行1回、保存後に通知、同じ会話への追加指示、失敗・切断・不確実な送信で自動再送なし、Mac/Windowsそれぞれで実測すること。
