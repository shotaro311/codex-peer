# Codex Peer

[日本語](#日本語) | [English](#english)

## 日本語

### Codex Peerとは

Codex Peerは、**Codex同士、またはClaude CodeからCodexへ依頼を送れるようにするプラグイン**です。

たとえば、Claude Codeから同じパソコンで動くCodexへ作業を依頼できます。また、Mac側のCodexからWindows側のCodexへ「Windowsにしかないファイルを確認して」「Windows側で新しいタスクを始めて」と依頼し、結果を受け取ることもできます。逆方向のWindowsからMacへの依頼にも対応します。

同じパソコン内ではClaude CodeとCodexを連携させ、複数のパソコンを使う場合は人間が別のパソコンへ移動して指示を入力し直す手間を減らすイメージです。

> [!WARNING]
> Codex Peerは開発者向けプレビュー版です。Codexの実験的なapp-server WebSocket APIを使っているため、Codexの更新によって動作しなくなる可能性があります。

### できること

- MacのCodexからWindowsのCodexへ依頼する
- WindowsのCodexからMacのCodexへ依頼する
- Claude Codeから、同じパソコンまたは別のパソコンで動くCodexへ依頼する（Claude Code側の導入設定が必要）
- 相手のパソコンにしかないファイル、アプリ、設定を調べてもらう
- 相手側で利用可能なComputer UseやBrowser Useなどを確認し、その相手側セッションで使ってもらう
- Computer Useやブラウザ操作を相手ごとに1件へ直列化し、同時起動による競合を防ぐ
- Mac・Windows双方で、劣化した専用app-serverをアイドル時だけ自動復旧する
- プロジェクトフォルダを指定せず、相手側で通常の新しいタスクを始める
- 時間のかかる作業が終わるまで待ち、結果を受け取る
- 相手側にあるCodexのタスク一覧や、過去のやり取りを確認する

たとえば、次のように自然な言葉で頼めます。

> Windows側のCodexに、今日の日付を聞いてください。
>
> Windows側で今日会話したタスクを一覧にしてください。
>
> Macにしかないプロジェクトを確認し、テスト結果をこちらへ報告してください。
>
> Claude CodeからWindows側のCodexへ、Windows固有の設定確認を依頼してください。
>
> Claude Codeから同じパソコンのCodexへ、新しいタスクを作って調査を依頼してください。

> [!IMPORTANT]
> このリポジトリはCodex Pluginとして配布しています。Claude Codeから使う場合は、Codex向けのインストールコマンドをそのまま使うのではなく、Claude Code公式のPlugin仕様またはMCP設定仕様に合わせて導入してください。Claude CodeのPluginでは`.claude-plugin/plugin.json`などの構成、MCPでは`claude mcp`コマンドや`.mcp.json`など、Claude Code側の現在の仕様に準拠する必要があります。現在のリリースには、Claude Code向けのワンコマンドインストーラーは含まれていません。

### できないこと

- 相手の画面をそのまま遠隔操作すること
- 相手のパソコンで許可されていない操作を実行すること
- 電源が切れているパソコンや、Codexが起動していない環境へ依頼すること
- ネットワークや認証の初期設定を完全に自動化すること

Codex Peerはリモートデスクトップではありません。相手側のCodexが、そのパソコンで利用できるツールと権限の範囲内で作業します。

### 画面・ブラウザ操作を依頼する場合

Codex Peerは、依頼元のComputer Use、ブラウザ、ログイン状態、Cookie、権限を相手側へ転送しません。画面やブラウザの操作は、対象アプリやログイン済みブラウザが存在するコンピューター側のCodexが、そのコンピューターで利用できる機能を使って実行します。

安全に依頼するため、相手側Codexには次の順序を明示してください。

1. 対象アプリやブラウザが存在するコンピューターを選ぶ
2. Computer Use、Browser Use、ブラウザ拡張など、使用する機能とSkillを明示する
3. 本操作前に、アプリ一覧や現在ページなどを読み取るだけの無害な確認を行う
4. ログイン済みブラウザが必要なら相手側の接続済みブラウザ拡張を優先し、対応ブラウザにはBrowser Use、デスクトップアプリや代替経路にはComputer Useを使う
5. Skillやプラグインを更新した直後は、新しいPeerタスクで利用可能な機能を読み込み直す
6. 確認に失敗した場合は、Codex Peer全体の接続障害ではなく、その機能固有の問題として報告する

`peer_health`が成功しても、確認できるのはCodex Peerとapp-serverの接続です。Computer UseやBrowser Useが現在の相手側セッションで実行できることは、各機能の読み取り確認で別途確かめます。

画面・ブラウザ作業には`peer_message`ではなく`peer_capability_message`を使います。これにより、同じ相手・同じ機能のタスクはプロセスをまたいで1件に制限され、読み取り専用の事前確認が成功した場合だけ本操作へ進みます。送信などの非冪等操作には「1回だけ実行し、不明時は再試行しない」という制約が自動で追加されます。

macOSまたはWindowsで`Sky Computer Use native pipe startup failed`が出た場合は、すぐに権限不足と断定しません。受信側にwatchdogを設定すると、接続中のタスクがない場合に限り、health、稼働時間、Computer Use helper数と古さを確認して専用app-serverだけを再起動します。macOSでは指定したLaunchAgent、Windowsでは待受PIDとコマンドを照合した専用プロセスだけが対象です。

### Codex公式機能との使い分け

Codexの標準リモート機能だけで目的を達成できる場合は、標準機能を優先してください。

Codex Peerは、**Claude CodeからCodexへ作業を委任したい場合**や、**2台以上のパソコンでCodex同士を連携させたい場合**に向いています。特に、作業を別のCodexへ分担する場合、相手側のローカル環境を調べる場合、MacとWindowsの双方向連携を一つの方法でそろえたい場合に役立ちます。

### 利用前に必要なもの

- 1台以上のパソコン（別のパソコンと連携する場合は2台以上）
- 依頼を受けるパソコンにCodex CLI
- 依頼を送るパソコンにCodexまたはClaude Code
- Codex Peerを動かすパソコンにNode.js 22以降
- 別のパソコンと連携する場合は、SSH転送または認証付きの`wss://`接続
- 初回設定のためのターミナル操作

現在はワンクリックで使い始められる製品ではありません。同じパソコン内で使う場合も、Claude CodeまたはCodexとapp-serverをつなぐ初期設定が必要です。別のパソコンと連携する場合は、ネットワークと認証の設定も必要です。一度設定すれば、その後は自然な言葉でCodexへの依頼を頼めます。

### おすすめの導入方法

ターミナル設定に慣れていない場合は、**CodexまたはClaude Codeへ、このリポジトリを自分の環境へ導入するよう依頼する方法がおすすめ**です。

利用するパソコンごとにCodexまたはClaude Codeを開き、次の依頼文を渡してください。

> https://github.com/shotaro311/codex-peer のREADME、`docs/setup.md`、`docs/security.md`を読み、私のパソコン環境を確認したうえでCodex Peerを導入してください。Codexへ入れる場合はCodex Plugin仕様、Claude Codeへ入れる場合はClaude CodeのPluginまたはMCP仕様に準拠してください。app-serverはlocalhostだけで待ち受けてください。別のパソコンと接続する場合は、SSH転送または認証付きWSSを使ってください。認証トークンは画面やログへ表示せず、最後に`peer_health`と安全なテスト依頼で接続を確認してください。ルーター、ファイアウォール、外部サービスの変更が必要な場合は、変更前に内容を説明してください。

AIに任せる場合でも、認証トークンを会話へ貼り付けず、表示された変更内容と接続テスト結果を確認してください。

### Codexへのインストール

ターミナルで次のコマンドを実行します。

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

利用者側で`npm install`を実行する必要はありません。

インストール後は、依頼を受ける側でCodex app-serverを起動します。別のパソコンと接続する場合は、SSH転送または認証付きWSS接続も設定します。詳しい手順は[セットアップガイド（英語）](docs/setup.md)を参照してください。

Claude Codeへ導入する場合は、前述の注意書きに従い、[Claude Code Plugin仕様](https://code.claude.com/docs/en/plugins)または[Claude Code MCP仕様](https://code.claude.com/docs/en/mcp)に合わせて設定してください。

### 安全上の注意

Codex Peerは、相手側のCodexへ作業を依頼できる強い権限を持つ接続です。

- app-serverをインターネットへ直接公開しないでください
- パソコンごとに異なる認証トークンを使ってください
- トークンをGitHub、プロンプト、Issue、スクリーンショットへ載せないでください
- 別のパソコンと接続する場合は、SSH転送、またはTLSと認証を備えた`wss://`接続を使ってください
- 相手側のCodexに与えているツールと権限を確認してください

初期状態では会話本文を記録しません。詳しくは[セキュリティガイド（英語）](docs/security.md)を参照してください。

### 提供している機能

- `peer_health`: 相手側との接続状態を確認する
- `peer_message`: 相手側で新しいタスクを始める、または既存タスクを続ける
- `peer_capability_message`: Computer Useやブラウザ作業を排他制御し、事前確認後に1回だけ実行する
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
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)

---

## English

Codex Peer lets one Codex instance, or Claude Code acting as an MCP client, send a task to another Codex instance and follow the resulting thread until it finishes. The Codex instances may run on the same computer or on different computers.

It supports Claude Code-to-Codex delegation on one computer as well as host-to-host collaboration across two or more computers, including projectless tasks and work that depends on a peer computer's local environment.

> [!WARNING]
> Codex Peer is a Developer Preview. It uses the experimental Codex app-server WebSocket API, which may change without backward compatibility.

### When to use it

Use Codex's native remote features first when they cover the workflow. Codex Peer is useful when you need a separately running Codex instance to:

- start or continue a projectless task;
- inspect files, applications, or state that exist only on that computer;
- exchange natural-language task reports with the calling Codex;
- work in either direction, such as Mac to Windows and Windows to Mac;
- ask a Codex running on the same or another computer to perform work from Claude Code;
- serialize peer-local GUI and browser work across caller processes;
- automatically recover an idle degraded receiver on either macOS or Windows.

Codex Peer does not provide remote desktop control. The peer Codex can only do what its own tools, permissions, and local environment allow.

### Delegating desktop and browser work

Codex Peer does not transfer the caller's Computer Use runtime, browser tabs, authenticated session, cookies, tools, or permissions to the peer. Desktop and browser work must run through the Codex instance on the computer that actually owns the target application or signed-in browser profile.

For capability-dependent work:

1. Route the task to the computer that owns the target application, browser profile, files, and authenticated session.
2. Explicitly tell the peer which local capability and skill to use, such as Computer Use, Browser Use, or an attached browser extension.
3. Require a harmless read-only preflight before consequential work, such as listing applications, inspecting the target app, or reading the current page.
4. Prefer an attached browser extension when an existing signed-in browser session is required, Browser Use on its supported browser surface, and Computer Use for desktop applications or fallback.
5. Start a new peer thread after installing or updating a required plugin, skill, or tool so the receiving Codex can load the current capability set.
6. If the preflight fails, report the capability-specific blocker instead of describing it as a generic Codex Peer connection failure.

`peer_health` verifies the peer app-server connection only. It does not prove that Computer Use, Browser Use, or a browser extension is callable in the current peer session.

Use `peer_capability_message` instead of `peer_message` for desktop and browser work. It serializes each peer and capability across caller processes, requires a harmless preflight, and adds exactly-once handling to non-idempotent actions.

If a macOS or Windows peer reports `Sky Computer Use native pipe startup failed`, do not immediately diagnose a permissions problem. The optional watchdog checks receiver health, uptime, helper count, helper age, and active connections. It restarts only an idle verified dedicated receiver: a configured LaunchAgent on macOS or the exact listener PID with validated command fragments on Windows.

> [!IMPORTANT]
> This repository is distributed as a Codex plugin. To use it from Claude Code, do not reuse the Codex installation commands unchanged. Package or configure the bundled MCP server according to the current Claude Code plugin or MCP specification. Claude Code plugins use structures such as `.claude-plugin/plugin.json`, while standalone MCP setup uses Claude Code's `claude mcp` commands or `.mcp.json` format. The current release does not include a one-command installer for Claude Code.

### Recommended setup

If you are not comfortable with terminal and network configuration, ask Codex or Claude Code to install Codex Peer for your environment. Open the agent in each environment that will participate and provide this prompt:

> Read the README, `docs/setup.md`, and `docs/security.md` at https://github.com/shotaro311/codex-peer, inspect my computer environment, and install Codex Peer. Follow the Codex plugin specification when installing it in Codex, or the Claude Code plugin or MCP specification when installing it in Claude Code. Keep app-server bound to localhost. When connecting different computers, use SSH forwarding or authenticated WSS. Never display authentication tokens, and verify the result with `peer_health` and a harmless test task. Explain any router, firewall, or external-service change before making it.

Do not paste authentication tokens into the conversation. Review the proposed changes and the connection-test result even when an AI performs the setup.

### Install in Codex

Node.js 22 or later and the Codex CLI are required.

```bash
codex plugin marketplace add shotaro311/codex-peer
codex plugin add codex-peer@codex-peer
```

The repository contains a bundled MCP server, so plugin users do not need to run `npm install`.

Continue with [Setup](docs/setup.md). When connecting different computers, keep the app-server on loopback and use a TLS-protected and authenticated network route such as SSH forwarding.

For Claude Code, configure the bundled server according to the [Claude Code plugin specification](https://code.claude.com/docs/en/plugins) or [Claude Code MCP specification](https://code.claude.com/docs/en/mcp), as described in the note above.

### Tools

- `peer_health`: verifies the connection and app-server initialization.
- `peer_message`: starts or continues a peer task.
- `peer_capability_message`: serializes capability-dependent work and requires a harmless preflight before action.
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

The current release covers remote app-server messaging, thread discovery, readback, long-turn tracking, serialized capability tasks, and an optional receiver watchdog. It does not include remote desktop, local LLM summarization, or a hosted relay service.

See [Troubleshooting](docs/troubleshooting.md), [Contributing](CONTRIBUTING.md), the [MIT License](LICENSE), and [third-party notices](THIRD_PARTY_NOTICES.md).

### Official references

- [Codex plugins](https://learn.chatgpt.com/docs/build-plugins.md)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server.md)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
