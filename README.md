# Codex Peer

[日本語](#日本語) | [English](#english)

## 日本語

### Codex Peerとは

Codex Peerは、**別々のパソコンで動いているCodex同士をつなぐプラグイン**です。

たとえば、Mac側のCodexからWindows側のCodexへ「Windowsにしかないファイルを確認して」「Windows側で新しいタスクを始めて」と依頼できます。Windows側のCodexが作業し、結果をMac側へ返します。逆方向のWindowsからMacへの依頼にも対応します。

人間が別のパソコンへ移動して同じ指示を入力し直す代わりに、Codex同士の連絡係として動くイメージです。

> [!WARNING]
> Codex Peerは開発者向けプレビュー版です。Codexの実験的なapp-server WebSocket APIを使っているため、Codexの更新によって動作しなくなる可能性があります。

### できること

- MacのCodexからWindowsのCodexへ依頼する
- WindowsのCodexからMacのCodexへ依頼する
- 相手のパソコンにしかないファイル、アプリ、設定を調べてもらう
- プロジェクトフォルダを指定せず、相手側で通常の新しいタスクを始める
- 時間のかかる作業が終わるまで待ち、結果を受け取る
- 相手側にあるCodexのタスク一覧や、過去のやり取りを確認する

たとえば、次のように自然な言葉で頼めます。

> Windows側のCodexに、今日の日付を聞いてください。
>
> Windows側で今日会話したタスクを一覧にしてください。
>
> Macにしかないプロジェクトを確認し、テスト結果をこちらへ報告してください。

### できないこと

- 相手の画面をそのまま遠隔操作すること
- 相手のパソコンで許可されていない操作を実行すること
- 電源が切れているパソコンや、Codexが起動していない環境へ依頼すること
- ネットワークや認証の初期設定を完全に自動化すること

Codex Peerはリモートデスクトップではありません。相手側のCodexが、そのパソコンで利用できるツールと権限の範囲内で作業します。

### Codex公式機能との使い分け

Codexの標準リモート機能だけで目的を達成できる場合は、標準機能を優先してください。

Codex Peerは、**2台以上のパソコンでそれぞれCodexを動かし、Codex同士が対等に依頼を送り合う必要がある場合**に向いています。特に、相手側のローカル環境を調べる作業や、MacとWindowsの双方向連携を一つの方法でそろえたい場合に役立ちます。

### 利用前に必要なもの

- 2台以上のパソコン
- それぞれのパソコンにCodex CLI
- Node.js 22以降
- パソコン同士を安全につなぐSSH転送、または認証付きの`wss://`接続
- 初回設定のためのターミナル操作

現在はワンクリックで使い始められる製品ではありません。ネットワークと認証の初期設定が必要です。一度設定すれば、その後はCodexへ自然な言葉で相手側への依頼を頼めます。

### インストール

ターミナルで次のコマンドを実行します。

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

利用者側で`npm install`を実行する必要はありません。

インストール後は、依頼を受ける側のパソコンでCodex app-serverを起動し、SSH転送または認証付きWSS接続を設定します。詳しい手順は[セットアップガイド（英語）](docs/setup.md)を参照してください。

### 安全上の注意

Codex Peerは、相手側のCodexへ作業を依頼できる強い権限を持つ接続です。

- app-serverをインターネットへ直接公開しないでください
- パソコンごとに異なる認証トークンを使ってください
- トークンをGitHub、プロンプト、Issue、スクリーンショットへ載せないでください
- SSH転送、またはTLSと認証を備えた`wss://`接続を使ってください
- 相手側のCodexに与えているツールと権限を確認してください

初期状態では会話本文を記録しません。詳しくは[セキュリティガイド（英語）](docs/security.md)を参照してください。

### 提供している機能

- `peer_health`: 相手側との接続状態を確認する
- `peer_message`: 相手側で新しいタスクを始める、または既存タスクを続ける
- `peer_wait`: 実行中の作業を一度確認する
- `peer_wait_until_complete`: 作業が終わるまで定期的に確認する
- `peer_threads`: 相手側のタスク一覧を取得する
- `peer_read`: 相手側のタスクにある最近のやり取りを読む

作業が失敗または中断された場合は、成功として扱いません。返答が空であるだけでは、作業完了とは判定しません。

### 現在の範囲

初回リリースは、Codex同士のメッセージ送信、タスク一覧の取得、結果の読み戻し、長時間タスクの追跡に範囲を絞っています。

次の機能は含まれていません。

- リモートデスクトップ
- 定期実行
- 中継用のクラウドサービス
- ローカルLLMによる自動要約

問題が起きた場合は[トラブルシューティング（英語）](docs/troubleshooting.md)を確認してください。改善への参加方法は[CONTRIBUTING.md](CONTRIBUTING.md)、ライセンスは[MIT License](LICENSE)に記載しています。

### 用語補足

- **Codex CLI:** ターミナルからCodexを使うための公式ツール
- **app-server:** 外部から届いた依頼をCodexへ渡すための受け口
- **SSH転送:** 2台のパソコン間に暗号化された安全な通信経路を作る方法
- **WSS:** WebSocket通信を暗号化した接続方式

### 開発者向け

```bash
npm ci
npm run check
npm audit --omit=dev
```

`npm run check`は配布ファイルを作り直し、テストとプラグイン構成の検証を実行します。

### 公式資料

- [Codex plugins](https://learn.chatgpt.com/docs/build-plugins.md)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server.md)

---

## English

Codex Peer lets one Codex instance send a task to another Codex instance running on a different computer, then follow the resulting thread until it finishes.

It is aimed at people who actively use Codex on two or more machines and need symmetric host-to-host collaboration, including projectless tasks and work that depends on the peer computer's local environment.

> [!WARNING]
> Codex Peer is a Developer Preview. It uses the experimental Codex app-server WebSocket API, which may change without backward compatibility.

### When to use it

Use Codex's native remote features first when they cover the workflow. Codex Peer is useful when you need a separately running Codex on another computer to:

- start or continue a projectless task;
- inspect files, applications, or state that exist only on that computer;
- exchange natural-language task reports with the calling Codex;
- work in either direction, such as Mac to Windows and Windows to Mac.

Codex Peer does not provide remote desktop control. The peer Codex can only do what its own tools, permissions, and local environment allow.

### Install

Node.js 22 or later and the Codex CLI are required.

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

The repository contains a bundled MCP server, so plugin users do not need to run `npm install`.

Continue with [Setup](docs/setup.md). Keep the app-server on loopback unless you have a TLS-protected and authenticated network route.

### Tools

- `peer_health`: verifies the connection and app-server initialization.
- `peer_message`: starts or continues a peer task.
- `peer_wait`: checks one existing peer turn.
- `peer_wait_until_complete`: quietly follows a turn until it ends or the local wait window expires.
- `peer_threads`: lists threads on the peer.
- `peer_read`: reads recent turns from a peer thread.

A running turn returns `ok: true` and `turnCompleted: false`. A failed or interrupted turn returns `ok: false`, its `turnStatus`, and a sanitized `turnError`; an empty response is never treated as proof of success.

### Privacy defaults

- Remote `wss://` peers require a token.
- Plain `ws://` is accepted only for loopback addresses.
- Credentials, query parameters, and fragments are rejected in peer URLs.
- Transcript recording is disabled by default.
- When explicitly enabled, transcripts contain event metadata only, not prompts or responses.

Read [Security](docs/security.md) before exposing any route beyond localhost.

### Development

```bash
npm ci
npm run check
npm audit --omit=dev
```

`npm run check` rebuilds `dist/codex-peer-mcp.mjs`, runs the test suite, and validates the plugin layout.

### Status and scope

The initial release is intentionally small: remote app-server messaging, thread discovery, readback, and long-turn tracking. It does not include scheduled jobs, remote desktop, local LLM summarization, or a relay service.

See [Troubleshooting](docs/troubleshooting.md), [Contributing](CONTRIBUTING.md), the [MIT License](LICENSE), and [third-party notices](THIRD_PARTY_NOTICES.md).

### Official references

- [Codex plugins](https://learn.chatgpt.com/docs/build-plugins.md)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server.md)
