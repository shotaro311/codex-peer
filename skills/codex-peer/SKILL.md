---
name: codex-peer
description: Mac Codex と Windows Codex など、別ホストの Codex app-server へ remote WebSocket 経由で自然会話ベースに依頼・確認したいときに使う。v1はremote専用で、execやローカルLLM要約は使わない。
---

# Codex Peer

## Purpose

このSkillは、Codex同士を remote でつなぎ、相手Codexへ自然文で依頼するための入口です。

v1では `codex exec` とローカルLLM連携は使いません。共同作業、相談、実装依頼、検証依頼は remote を使います。

## Core Rules

- 相手Codexの自然な報告を読み、受け取り側Codexが次の行動を判断します。
- `peerStatus` のような機械的な完了ラベルを相手Codexに強制しません。
- `turn/completed` は「相手Codexの今回の返答が終わった」ことだけを意味します。
- 作業時間だけで失敗扱いしません。1時間以上のturnも正常系として扱います。
- `peer_message` が `turnCompleted: false` を返したら、`threadId` と `turnId` を使って `peer_wait` または `peer_read` で後から確認します。
- 5往復を超えたら、`needsUserCheck` を目安にユーザーへ進捗確認します。単一turnが長いだけでは確認要求にしません。

## Tool Use

1. `peer_health` で接続確認します。
2. `peer_message` で相手Codexへ自然文の依頼を送ります。
3. `turnCompleted: false` の場合は、相手側で作業継続中として `peer_wait` で追跡します。
4. 返ってきた `finalText` や途中情報を読み、受け取り側Codexが次のアクションを判断します。

## Output Style

ユーザーへの報告は、相手Codexの返答をそのまま長く貼りすぎず、要点、次にこちらが取る行動、ユーザー確認が必要な点だけを短くまとめます。

補足:
- `remote`: Codex app-server の WebSocket 経由で別Codexへ接続する方式。
- `turn/completed`: 1回のCodex応答が終わった通知。
- `threadId` / `turnId`: 後から同じ会話・同じ応答を追跡するためのID。
