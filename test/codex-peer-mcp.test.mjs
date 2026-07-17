import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { WebSocketServer } from "ws";
import {
  callPeerHealth,
  callPeerMessage,
  callPeerRead,
  callPeerWait,
  callPeerWaitUntilComplete,
  createTurnCollector,
  needsUserCheckForTurns,
  normalizePeerConfig,
  readPeerToken,
  resolvePeer,
  truncate,
  validatePeerConnectionPolicy
} from "../scripts/codex-peer-mcp.mjs";

let servers = [];
let tempDirs = [];

beforeEach(() => {
  process.env.CODEX_PEER_RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codex-peer-runs-"));
  tempDirs.push(process.env.CODEX_PEER_RUN_DIR);
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise(resolve => server.close(resolve));
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.CODEX_PEER_RUN_DIR;
});

describe("config", () => {
  it("normalizes defaults", () => {
    const config = normalizePeerConfig({
      peers: {
        windows: {
          url: "wss://example.com",
          authTokenEnv: "TOKEN"
        }
      }
    });

    assert.equal(config.defaults.maxResponseChars, 8000);
    assert.equal(config.defaults.progressCheckAfterTurns, 5);
    assert.equal(config.defaults.waitWindowSeconds, 7200);
    assert.equal(config.defaults.pollIntervalSeconds, 15);
    assert.equal(config.defaults.recordTranscripts, false);
  });

  it("rejects non-loopback ws URLs", () => {
    assert.throws(
      () => validatePeerConnectionPolicy({ url: "ws://example.com:1234" }),
      /non-loopback ws/
    );
  });

  it("rejects credentials and query parameters in peer URLs", () => {
    assert.throws(
      () => validatePeerConnectionPolicy({ url: "wss://user:secret@example.com/path?token=secret" }),
      /must not contain credentials/
    );
  });

  it("requires authentication for remote wss peers", () => {
    const config = normalizePeerConfig({
      peers: {
        windows: { url: "wss://example.com" }
      }
    });

    assert.throws(
      () => resolvePeer(config, "windows", {}),
      /require authTokenEnv or authTokenFile/
    );
  });

  it("requires configured token env vars without leaking values", () => {
    const config = normalizePeerConfig({
      peers: {
        windows: {
          url: "wss://example.com",
          authTokenEnv: "CODEX_PEER_TEST_TOKEN"
        }
      }
    });

    assert.throws(
      () => resolvePeer(config, "windows", {}),
      /CODEX_PEER_TEST_TOKEN/
    );
  });

  it("reads token files when env vars are not set", () => {
    const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-peer-token-"));
    tempDirs.push(tokenDir);
    const tokenPath = path.join(tokenDir, "windows.token");
    fs.writeFileSync(tokenPath, "file-token\n", { mode: 0o600 });
    const config = normalizePeerConfig({
      peers: {
        windows: {
          url: "wss://example.com",
          authTokenEnv: "CODEX_PEER_TEST_TOKEN",
          authTokenFile: tokenPath
        }
      }
    });

    const peer = resolvePeer(config, "windows", {});

    assert.equal(peer.authToken, "file-token");
  });

  it("prefers token env vars over token files", () => {
    const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-peer-token-"));
    tempDirs.push(tokenDir);
    const tokenPath = path.join(tokenDir, "windows.token");
    fs.writeFileSync(tokenPath, "file-token\n", { mode: 0o600 });

    assert.equal(
      readPeerToken(
        {
          authTokenEnv: "CODEX_PEER_TEST_TOKEN",
          authTokenFile: tokenPath
        },
        { CODEX_PEER_TEST_TOKEN: "env-token" }
      ),
      "env-token"
    );
  });

  it("marks the fifth peer turn for user check", () => {
    assert.equal(needsUserCheckForTurns(4, 5), false);
    assert.equal(needsUserCheckForTurns(5, 5), true);
  });
});

describe("turn collector", () => {
  it("caps streamed text accumulation at the response limit", () => {
    const collector = createTurnCollector("thread-1", 10);
    collector.handle("turn/started", { threadId: "thread-1", turn: { id: "turn-1" } });
    for (let i = 0; i < 50; i += 1) {
      collector.handle("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", delta: "0123456789" });
    }

    assert.equal(collector.text.length, 11);
    assert.ok(truncate(collector.text, 10).endsWith("…"));
  });

  it("keeps short streamed text unchanged", () => {
    const collector = createTurnCollector("thread-1", 100);
    collector.handle("turn/started", { threadId: "thread-1", turn: { id: "turn-1" } });
    collector.handle("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", delta: "Short reply." });

    assert.equal(collector.text, "Short reply.");
  });
});

describe("peer tools", () => {
  it("checks peer health", async () => {
    const fake = await startFakeAppServer();
    const config = configFor(fake.url);

    const result = await callPeerHealth(config, { peerId: "windows" });

    assert.equal(result.ok, true);
    assert.equal(result.platformOs, "windows");
  });

  it("returns finalText when the turn completes quickly", async () => {
    const fake = await startFakeAppServer({ reply: "Done from Windows." });
    const config = configFor(fake.url);

    const result = await callPeerMessage(
      config,
      { peerId: "windows", message: "Please check health." },
      { initialWaitMs: 200 }
    );

    assert.equal(result.ok, true);
    assert.equal(result.turnCompleted, true);
    assert.equal(result.finalText, "Done from Windows.");
    assert.equal(result.turnStatus, "completed");
    assert.equal(result.turnSucceeded, true);
    assert.equal(result.transcriptPath, null);
  });

  it("records only metadata when transcripts are explicitly enabled", async () => {
    const fake = await startFakeAppServer({ reply: "secret peer response" });
    const config = configFor(fake.url, { recordTranscripts: true });

    const result = await callPeerMessage(
      config,
      { peerId: "windows", message: "secret user request" },
      { initialWaitMs: 200 }
    );

    assert.ok(fs.existsSync(result.transcriptPath));
    const transcript = fs.readFileSync(result.transcriptPath, "utf8");
    assert.doesNotMatch(transcript, /secret user request/);
    assert.doesNotMatch(transcript, /secret peer response/);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(result.transcriptPath).mode & 0o777, 0o600);
    }
  });

  it("does not block on long-running turns", async () => {
    const fake = await startFakeAppServer({ completeDelayMs: null, reply: "Working..." });
    const config = configFor(fake.url);

    const result = await callPeerMessage(
      config,
      { peerId: "windows", message: "Start a long task." },
      { initialWaitMs: 20 }
    );

    assert.equal(result.ok, true);
    assert.equal(result.turnCompleted, false);
    assert.match(result.threadId, /^thread-/);
    assert.match(result.turnId, /^turn-/);
    assert.equal(result.latestText, "Working...");
  });

  it("reports failed peer turns as failures", async () => {
    const fake = await startFakeAppServer({
      reply: "",
      finalStatus: "failed",
      turnError: { message: "Sandbox denied the operation." }
    });
    const config = configFor(fake.url);

    const result = await callPeerMessage(
      config,
      {
        peerId: "windows",
        message: "Run a failing task.",
        waitForCompletion: true,
        waitWindowSeconds: 1
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.turnCompleted, true);
    assert.equal(result.turnStatus, "failed");
    assert.equal(result.turnSucceeded, false);
    assert.equal(result.turnError, "Sandbox denied the operation.");
    assert.equal(result.finalText, "");
  });

  it("redacts token-like values from peer turn errors", async () => {
    const fake = await startFakeAppServer({
      reply: "",
      finalStatus: "failed",
      turnError: { message: "Request failed with token=do-not-leak and ?secret=hidden" }
    });
    const config = configFor(fake.url);

    const result = await callPeerMessage(
      config,
      {
        peerId: "windows",
        message: "Run a failing task.",
        waitForCompletion: true,
        waitWindowSeconds: 1
      }
    );

    assert.doesNotMatch(result.turnError, /do-not-leak|hidden/);
    assert.match(result.turnError, /\[redacted\]/);
  });

  it("can keep a peer message quiet until completion", async () => {
    const fake = await startFakeAppServer({ completeDelayMs: 60, reply: "Quiet result." });
    const config = configFor(fake.url);

    const result = await callPeerMessage(
      config,
      {
        peerId: "windows",
        message: "Wait quietly.",
        waitForCompletion: true,
        waitWindowSeconds: 1
      },
      { initialWaitMs: 5 }
    );

    assert.equal(result.ok, true);
    assert.equal(result.turnCompleted, true);
    assert.equal(result.finalText, "Quiet result.");
    assert.equal(result.latestText, undefined);
  });

  it("resumes existing threads before starting a new turn", async () => {
    const fake = await startFakeAppServer({ reply: "Resumed result." });
    const config = configFor(fake.url);
    const first = await callPeerMessage(
      config,
      { peerId: "windows", message: "Create thread." },
      { initialWaitMs: 200 }
    );

    const second = await callPeerMessage(
      config,
      { peerId: "windows", threadId: first.threadId, message: "Continue thread." },
      { initialWaitMs: 200 }
    );

    assert.equal(second.turnCompleted, true);
    assert.equal(fake.state.resumeCalls, 1);
  });

  it("can wait for a previously running turn", async () => {
    const fake = await startFakeAppServer({ completeDelayMs: 80, reply: "Later result." });
    const config = configFor(fake.url);

    const started = await callPeerMessage(
      config,
      { peerId: "windows", message: "Start and finish later." },
      { initialWaitMs: 5 }
    );
    assert.equal(started.turnCompleted, false);

    await sleep(120);
    const waited = await callPeerWait(config, {
      peerId: "windows",
      threadId: started.threadId,
      turnId: started.turnId
    });

    assert.equal(waited.turnCompleted, true);
    assert.equal(waited.finalText, "Later result.");
  });

  it("reports failures when checking a previously running turn", async () => {
    const fake = await startFakeAppServer({
      completeDelayMs: 50,
      reply: "",
      finalStatus: "interrupted",
      turnError: { message: "The peer turn was interrupted." }
    });
    const config = configFor(fake.url);

    const started = await callPeerMessage(
      config,
      { peerId: "windows", message: "Start an interrupted task." },
      { initialWaitMs: 5 }
    );
    await sleep(80);

    const waited = await callPeerWait(config, {
      peerId: "windows",
      threadId: started.threadId,
      turnId: started.turnId
    });

    assert.equal(waited.ok, false);
    assert.equal(waited.turnStatus, "interrupted");
    assert.equal(waited.turnSucceeded, false);
    assert.equal(waited.turnError, "The peer turn was interrupted.");
  });

  it("can quietly wait for a previously running turn until it completes", async () => {
    const fake = await startFakeAppServer({ completeDelayMs: 80, reply: "Quiet later result." });
    const config = configFor(fake.url);

    const started = await callPeerMessage(
      config,
      { peerId: "windows", message: "Start and wait quietly later." },
      { initialWaitMs: 5 }
    );
    assert.equal(started.turnCompleted, false);

    const waited = await callPeerWaitUntilComplete(config, {
      peerId: "windows",
      threadId: started.threadId,
      turnId: started.turnId,
      waitWindowSeconds: 1,
      pollIntervalSeconds: 0.01
    });

    assert.equal(waited.turnCompleted, true);
    assert.equal(waited.finalText, "Quiet later result.");
    assert.ok(waited.waitedMs >= 0);
  });

  it("returns running after the quiet wait window without failing the task", async () => {
    const fake = await startFakeAppServer({ completeDelayMs: null, reply: "Still working." });
    const config = configFor(fake.url);

    const started = await callPeerMessage(
      config,
      { peerId: "windows", message: "Start a long task." },
      { initialWaitMs: 5 }
    );

    const waited = await callPeerWaitUntilComplete(config, {
      peerId: "windows",
      threadId: started.threadId,
      turnId: started.turnId,
      waitWindowSeconds: 0.02,
      pollIntervalSeconds: 0.01
    });

    assert.equal(waited.ok, true);
    assert.equal(waited.turnCompleted, false);
    assert.equal(waited.latestText, "");
    assert.match(waited.warnings[0], /quiet wait window/);
  });

  it("reads recent turns", async () => {
    const fake = await startFakeAppServer({ reply: "Readable result." });
    const config = configFor(fake.url);
    const sent = await callPeerMessage(
      config,
      { peerId: "windows", message: "Create readable thread." },
      { initialWaitMs: 200 }
    );

    const read = await callPeerRead(config, {
      peerId: "windows",
      threadId: sent.threadId
    });

    assert.equal(read.ok, true);
    assert.equal(read.turns.length, 1);
    assert.equal(read.finalText, "Readable result.");
  });
});

function configFor(url, defaults = {}) {
  return normalizePeerConfig({
    peers: {
      windows: {
        label: "Windows Codex",
        url,
        defaultCwd: "C:\\Users\\user\\code",
        platform: "windows"
      }
    },
    defaults: {
      maxResponseChars: 8000,
      progressCheckAfterTurns: 5,
      ...defaults
    }
  });
}

async function startFakeAppServer(options = {}) {
  const state = {
    nextThread: 1,
    nextTurn: 1,
    threads: new Map(),
    reply: options.reply ?? "Fake reply.",
    completeDelayMs: options.completeDelayMs === undefined ? 5 : options.completeDelayMs,
    finalStatus: options.finalStatus || "completed",
    turnError: options.turnError || null,
    resumeCalls: 0
  };
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);

  server.on("connection", socket => {
    socket.on("message", data => {
      const message = JSON.parse(String(data));
      handleFakeMessage(socket, state, message);
    });
  });

  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  return { server, state, url: `ws://127.0.0.1:${port}` };
}

function handleFakeMessage(socket, state, message) {
  const respond = result => socket.send(JSON.stringify({ id: message.id, result }));

  if (message.method === "initialize") {
    respond({
      userAgent: "fake-codex",
      codexHome: "C:\\Users\\user\\.codex",
      platformFamily: "windows",
      platformOs: "windows"
    });
    return;
  }

  if (message.method === "thread/start") {
    const thread = {
      id: `thread-${state.nextThread++}`,
      cwd: message.params.cwd || null,
      preview: "",
      name: null,
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      status: { type: "idle" },
      turns: []
    };
    state.threads.set(thread.id, thread);
    respond({ thread });
    return;
  }

  if (message.method === "turn/start") {
    const thread = state.threads.get(message.params.threadId);
    const turn = {
      id: `turn-${state.nextTurn++}`,
      items: [{
        type: "userMessage",
        id: "user-1",
        content: message.params.input
      }],
      status: "inProgress",
      error: null,
      startedAt: Date.now() / 1000,
      completedAt: null,
      durationMs: null
    };
    thread.turns.unshift(turn);
    thread.status = { type: "active", activeFlags: [] };
    respond({ turn: { id: turn.id } });
    setTimeout(() => {
      socket.send(JSON.stringify({
        method: "turn/started",
        params: { threadId: thread.id, turn: { id: turn.id } }
      }));
      socket.send(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { threadId: thread.id, turnId: turn.id, itemId: "agent-1", delta: state.reply }
      }));
    }, 0);
    if (state.completeDelayMs !== null) {
      setTimeout(() => {
        turn.items.push({
          type: "agentMessage",
          id: "agent-1",
          text: state.reply,
          phase: null,
          memoryCitation: null
        });
        turn.status = state.finalStatus;
        turn.error = state.turnError;
        turn.completedAt = Date.now() / 1000;
        turn.durationMs = 1;
        thread.status = { type: "idle" };
        socket.send(JSON.stringify({
          method: "turn/completed",
          params: {
            threadId: thread.id,
            turn: { id: turn.id, status: state.finalStatus, error: state.turnError }
          }
        }));
      }, state.completeDelayMs);
    }
    return;
  }

  if (message.method === "thread/resume") {
    state.resumeCalls += 1;
    respond({ thread: state.threads.get(message.params.threadId) });
    return;
  }

  if (message.method === "thread/turns/list") {
    const thread = state.threads.get(message.params.threadId);
    respond({
      data: (thread?.turns || []).slice(0, message.params.limit || 20),
      nextCursor: null,
      backwardsCursor: null
    });
    return;
  }

  if (message.method === "thread/read") {
    respond({ thread: state.threads.get(message.params.threadId) || null });
    return;
  }

  if (message.method === "thread/list") {
    respond({
      data: [...state.threads.values()].map(thread => ({ ...thread, turns: [] })),
      nextCursor: null,
      backwardsCursor: null
    });
    return;
  }

  respond({});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
