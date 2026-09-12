import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { GeminiPeerServer, normalizeConfig, buildAgyArgs, subscriptionEnv, checkSubscriptionSettings } from "../scripts/gemini-peer-server.mjs";
import { normalizePeerConfig, callPeerMessage, callPeerRead, callPeerHealth } from "../scripts/codex-peer-mcp.mjs";

const resources = [];
const validateState = new AjvJsonSchemaValidator().getValidator(JSON.parse(fs.readFileSync(new URL("../schemas/gemini-peer-state.schema.json", import.meta.url))));
afterEach(async () => {
  for (const { server, root } of resources.splice(0)) {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-peer-test-"));
  const tokenFile = path.join(root, "token");
  fs.writeFileSync(tokenFile, "test-only-token-for-loopback-12345678", { mode: 0o600 });
  const config = normalizeConfig({ stateDir: path.join(root, "state"), authTokenFile: tokenFile, listen: { port: 0 }, ...options }, { HOME: root });
  const resource = { root, config };
  resources.push(resource);
  return resource;
}

function fakeSpawn(scenario, invocations = []) {
  return (bin, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = "";
    let closed = false;
    child.kill = signal => {
      if (!closed) { closed = true; queueMicrotask(() => child.emit("close", null, signal || "SIGTERM")); }
      return true;
    };
    child.stdin.on("data", chunk => { input += chunk; });
    child.stdin.on("finish", () => {
      invocations.push({ bin, args, options, input });
      queueMicrotask(() => scenario({ child, args, input, emit: event => child.stdout.write(JSON.stringify(event) + "\n"),
        close: code => { if (!closed) { closed = true; child.emit("close", code, null); } } }));
    });
    return child;
  };
}

function success({ emit, args, close }, response = "Completed analysis; parent should verify findings.") {
  const conversation = args.includes("--conversation") ? args[args.indexOf("--conversation") + 1] : randomUUID();
  emit({ event: "init", conversation_id: conversation, init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } });
  emit({ event: "result", result: { conversation_id: conversation, status: "SUCCESS", response } });
  close(0);
}

async function setup(scenario = success, configOptions = {}) {
  const f = fixture(configOptions);
  const calls = [];
  f.server = new GeminiPeerServer(f.config, { env: { HOME: f.root, GEMINI_API_KEY: "never-forward", PATH: process.env.PATH }, spawn: fakeSpawn(scenario, calls) });
  const address = await f.server.listen();
  const peerConfig = normalizePeerConfig({ peers: { gemini: { url: `ws://127.0.0.1:${address.port}`, authTokenFile: f.config.authTokenFile } }, defaults: { recordTranscripts: false } });
  return { ...f, calls, peerConfig };
}

test("pins model and execution mode, resumes the exact conversation, and never supplies permission bypass", () => {
  const { config } = fixture();
  const id = randomUUID();
  const args = buildAgyArgs(config, id);
  assert.equal(args[args.indexOf("--mode") + 1], "plan");
  assert.equal(args[args.indexOf("--conversation") + 1], id);
  assert.ok(!args.includes("-p"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.equal(buildAgyArgs(config, null, "workspace-write")[7], "accept-edits");
  assert.throws(() => buildAgyArgs(config, "../../bad"), /conversation ID/);
  assert.throws(() => normalizeConfig({ ...config, model: "fallback-model" }), /Only Gemini/);
  assert.throws(() => normalizeConfig({ ...config, listen: { host: "0.0.0.0" } }), /loopback/);
});

test("native Windows executable path and API environment exclusion", () => {
  const config = normalizeConfig({ authTokenFile: "token" }, { USERPROFILE: "C:\\Users\\tester", LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "win32");
  assert.equal(config.agyBin, "C:\\Users\\tester\\AppData\\Local\\agy\\bin\\agy.exe");
  assert.deepEqual(subscriptionEnv({ PATH: "ok", GEMINI_API_KEY: "x", GOOGLE_GEMINI_BASE_URL: "url", GOOGLE_APPLICATION_CREDENTIALS: "file" }), { PATH: "ok" });
});

test("rejects an API provider without modifying settings or spawning", () => {
  const { config } = fixture();
  fs.mkdirSync(path.dirname(config.settingsFile), { recursive: true });
  const raw = JSON.stringify({ modelProvider: "gemini" });
  fs.writeFileSync(config.settingsFile, raw);
  assert.throws(() => checkSubscriptionSettings(config), /account authentication/);
  assert.equal(fs.readFileSync(config.settingsFile, "utf8"), raw);
});

test("rejects additional credit fallback before spawn, including changes after receiver startup", async () => {
  const f = await setup();
  fs.mkdirSync(path.dirname(f.config.settingsFile), { recursive: true });
  const raw = JSON.stringify({ useG1Credits: true });
  fs.writeFileSync(f.config.settingsFile, raw);
  const thread = f.server.handleRequest("thread/start", {}).thread;
  assert.throws(() => f.server.handleRequest("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Run" }] }), /no additional credits fallback/);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.readFileSync(f.config.settingsFile, "utf8"), raw);
  fs.writeFileSync(f.config.settingsFile, JSON.stringify({ useG1Credits: false }));
  assert.doesNotThrow(() => checkSubscriptionSettings(f.config));
});

test("existing peer client can health, delegate, read, and resume without a model call during health", async () => {
  const f = await setup();
  assert.equal((await callPeerHealth(f.peerConfig, { peerId: "gemini" })).ok, true);
  assert.equal(f.calls.length, 0);
  const first = await callPeerMessage(f.peerConfig, { peerId: "gemini", message: "Review this task", executionMode: "workspace-write", waitForCompletion: true, waitWindowSeconds: 2 });
  assert.equal(first.turnSucceeded, true);
  const read = await callPeerRead(f.peerConfig, { peerId: "gemini", threadId: first.threadId });
  assert.ok(JSON.stringify(read).includes("Completed analysis"));
  const second = await callPeerMessage(f.peerConfig, { peerId: "gemini", threadId: first.threadId, message: "Continue", waitForCompletion: true, waitWindowSeconds: 2 });
  assert.equal(second.turnSucceeded, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].args.includes("--conversation"));
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf("--mode") + 1], "accept-edits");
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[0].options.env.GEMINI_API_KEY, undefined);
  assert.equal(JSON.parse(f.calls[0].input).event, "user");
});

test("new turns preserve exact submitted input and expose it before the agent response", async () => {
  const f = await setup();
  const thread = f.server.handleRequest("thread/start", {}).thread;
  const input = [{ type: "text", text: "  検証用の依頼です。\r\n引用: \"元の表記\"  " }, { type: "text", text: "次の行も保持してください。🙂\n" }];
  const expected = input.map(item => item.text).join("\n");
  const started = f.server.handleRequest("turn/start", { threadId: thread.id, input }).turn;
  const userMessage = { id: `${started.id}-input`, type: "userMessage", content: [{ type: "text", text: expected }] };
  assert.equal(f.server.read("turns", started.id).inputText, expected);
  assert.deepEqual(started.items, [userMessage]);
  await new Promise(resolve => setImmediate(resolve));
  const saved = f.server.read("turns", started.id);
  assert.equal(saved.version, 1); assert.equal(saved.inputText, expected);
  const wire = f.server.handleRequest("thread/read", { threadId: thread.id }).thread.turns[0];
  assert.deepEqual(wire.items[0], userMessage);
  assert.equal(wire.items[1].type, "agentMessage"); assert.equal(wire.items[1].text, saved.text);
  assert.equal(validateState(saved).valid, true);
});

test("multiple turns retain their own inputs when the receiver reads history after restart", async () => {
  const f = await setup();
  const firstInput = "最初の依頼\n  末尾の空白も保持  ";
  const secondInput = "追加の依頼です。前の入力を上書きしないでください。";
  const first = await callPeerMessage(f.peerConfig, { peerId: "gemini", message: firstInput, waitForCompletion: true, waitWindowSeconds: 2 });
  const second = await callPeerMessage(f.peerConfig, { peerId: "gemini", threadId: first.threadId, message: secondInput, waitForCompletion: true, waitWindowSeconds: 2 });
  assert.equal(first.turnSucceeded, true); assert.equal(second.turnSucceeded, true);
  await f.server.close();
  f.server = new GeminiPeerServer(f.config, { spawn: () => { throw new Error("history read must not rerun work"); } });
  resources.find(resource => resource.root === f.root).server = f.server;
  await f.server.listen();
  const turns = f.server.handleRequest("thread/read", { threadId: first.threadId }).thread.turns;
  assert.equal(turns.length, 2);
  for (const [id, expected] of [[first.turnId, firstInput], [second.turnId, secondInput]]) {
    const saved = f.server.read("turns", id);
    assert.equal(saved.inputText, expected);
    const wire = turns.find(turn => turn.id === id);
    assert.deepEqual(wire.items[0].content, [{ type: "text", text: expected }]);
    assert.equal(wire.items[0].type, "userMessage"); assert.equal(wire.items[1].type, "agentMessage");
  }
  assert.equal(f.calls.length, 2);
});

test("legacy v1 turns without input remain readable without inventing a user message from the preview", async () => {
  const f = await setup();
  const thread = f.server.handleRequest("thread/start", {}).thread;
  thread.preview = "A summary is not the original input";
  f.server.save("threads", thread);
  const fixtures = JSON.parse(fs.readFileSync(new URL("fixtures/gemini-peer-states.json", import.meta.url)));
  const legacy = { ...fixtures.find(value => value.status === "completed" && !Object.hasOwn(value, "inputText")), threadId: thread.id };
  f.server.save("turns", legacy);
  const saved = f.server.read("turns", legacy.id);
  assert.equal(Object.hasOwn(saved, "inputText"), false);
  assert.equal(validateState(saved).valid, true);
  const wire = f.server.handleRequest("thread/read", { threadId: thread.id }).thread.turns[0];
  assert.deepEqual(wire.items, [{ type: "agentMessage", text: legacy.text }]);
  assert.equal(f.calls.length, 0);
});

for (const [name, scenario] of [
  ["wrong model", ({ emit, close }) => { emit({ event: "init", conversation_id: randomUUID(), init: { model: "other" } }); close(0); }],
  ["missing result", ({ emit, close }) => { emit({ event: "init", conversation_id: randomUUID(), init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } }); close(0); }],
  ["error result", ({ emit, close }) => { emit({ event: "result", result: { status: "ERROR", response: "", error: "private diagnostic" } }); close(1); }],
  ["malformed JSON", ({ child, close }) => { child.stdout.write("not-json\n"); close(0); }],
  ["empty response", ctx => success(ctx, "")],
  ["SUCCESS followed by exit failure", ctx => success({ ...ctx, close: () => ctx.close(1) })],
  ["duplicate result", ctx => {
    const id = randomUUID();
    ctx.emit({ event: "init", conversation_id: id, init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } });
    const event = { event: "result", result: { conversation_id: id, status: "SUCCESS", response: "result" } };
    ctx.emit(event); ctx.emit(event); ctx.close(0);
  }],
  ["result from another conversation", ctx => {
    ctx.emit({ event: "init", conversation_id: randomUUID(), init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } });
    ctx.emit({ event: "result", result: { conversation_id: randomUUID(), status: "SUCCESS", response: "result" } }); ctx.close(0);
  }],
  ["inherited permission bypass", ctx => {
    ctx.emit({ event: "init", conversation_id: randomUUID(), init: { model: "gemini-3.8-flash-medium", permission_mode: "always-proceed" } }); ctx.close(0);
  }],
  ["soft deny with exit zero", ctx => { ctx.child.stderr.write("run_command was soft-denied: requires approval\n"); success(ctx); }],
  ["tool error with SUCCESS", ctx => {
    const id = randomUUID();
    ctx.emit({ event: "init", conversation_id: id, init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } });
    ctx.emit({ event: "step_update", step_update: { tool_info: { error: { type: "permission_denied", message: "private" } } } });
    ctx.emit({ event: "result", result: { conversation_id: id, status: "SUCCESS", response: "The command could not run" } }); ctx.close(0);
  }]
]) test(`does not report success for ${name}`, async () => {
  const f = await setup(scenario);
  const result = await callPeerMessage(f.peerConfig, { peerId: "gemini", message: "Test", waitForCompletion: true, waitWindowSeconds: 2 });
  assert.equal(result.turnSucceeded, false);
  assert.ok(!JSON.stringify(result).includes("private diagnostic"));
  assert.ok(result.turnError);
  assert.equal(f.calls.length, 1);
});

test("survives client disconnect, saves completion, and rejects concurrent turn and cwd escape", async () => {
  let finish;
  const f = await setup(ctx => { finish = () => success(ctx); });
  const thread = f.server.handleRequest("thread/start", {}).thread;
  const response = f.server.handleRequest("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Do work" }] });
  assert.throws(() => f.server.handleRequest("turn/start", { threadId: thread.id, input: [{ type: "text", text: "duplicate" }] }), /already/);
  assert.throws(() => f.server.handleRequest("thread/start", { cwd: os.tmpdir() }), /outside/);
  await new Promise(resolve => setImmediate(resolve));
  finish();
  assert.equal(f.server.read("turns", response.turn.id).status, "completed");
  assert.equal(f.server.turns(thread.id)[0].gemini.taskCompletion, "requires-parent-readback");
});

test("reports the required permission from an actual AGY soft-deny shape without exposing its target", async () => {
  const f = await setup(ctx => {
    const id = randomUUID();
    ctx.emit({ event: "init", conversation_id: id, init: { model: "gemini-3.8-flash-medium", permission_mode: "request-review" } });
    ctx.emit({ event: "step_update", step_update: { step_type: "tool", tool_name: "list_dir", state: "ERROR",
      tool_info: { error: { type: "TOOL_ERROR", message: 'permission check failed for read_file "/private-target": user denied permission for read_file(/private-target)' } } } });
    ctx.emit({ event: "result", result: { conversation_id: id, status: "SUCCESS", response: "" } });
    ctx.close(0);
  });
  const result = await callPeerMessage(f.peerConfig, { peerId: "gemini", message: "List workspace", waitForCompletion: true, waitWindowSeconds: 2 });
  assert.equal(result.turnSucceeded, false);
  assert.match(result.turnError, /list_dir \(requires read_file\)/);
  assert.ok(!JSON.stringify(result).includes("private-target"));
  const turn = f.server.read("turns", result.turnId);
  assert.equal(turn.permissionDenied, true);
  assert.deepEqual(turn.toolFailures, [{ name: "list_dir", requiredPermission: "read_file" }]);
});

test("server restart marks orphaned work interrupted and never resubmits", async () => {
  const f = await setup();
  const thread = f.server.handleRequest("thread/start", {}).thread;
  f.server.save("turns", { id: randomUUID(), threadId: thread.id, status: "inProgress", startedAt: new Date().toISOString() });
  await f.server.close();
  f.server = new GeminiPeerServer(f.config, { spawn: () => { throw new Error("must not spawn"); } });
  resources.find(r => r.root === f.root).server = f.server;
  await f.server.listen();
  assert.equal(f.server.turns(thread.id)[0].status, "interrupted");
});

test("does not acquire state already owned by another receiver", async () => {
  const f = await setup();
  const second = new GeminiPeerServer(f.config);
  await assert.rejects(second.listen(), /already owned/);
  assert.equal(f.server.handleRequest("initialize").serverInfo.name, "gemini-peer-server");
  assert.ok(fs.existsSync(path.join(f.config.stateDir, "server.lock")));
});

test("emits one completion only after process exit and saved state", async () => {
  let finish;
  const f = await setup(ctx => { finish = () => success(ctx); });
  const events = [];
  f.server.broadcast = (method, params) => {
    if (method === "turn/completed") {
      assert.equal(f.server.read("turns", params.turn.id).status, "completed");
      events.push(params);
    }
  };
  const thread = f.server.handleRequest("thread/start", {}).thread;
  f.server.handleRequest("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Work" }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 0);
  finish();
  assert.equal(events.length, 1);
});

test("rejects unauthenticated and browser-origin WebSocket connections", async () => {
  const f = await setup();
  const url = f.peerConfig.peers.gemini.url;
  for (const options of [{}, { headers: { Authorization: "Bearer test-only-token-for-loopback-12345678", Origin: "https://example.org" } }]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url, options);
      ws.on("open", () => { ws.close(); reject(new Error("unexpected connection")); });
      ws.on("error", error => { assert.match(error.message, /401/); resolve(); });
    });
  }
});

test("v1 state fixtures preserve old optional fields and reject incompatible or false-complete records", () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL("fixtures/gemini-peer-states.json", import.meta.url)));
  for (const fixture of fixtures) assert.equal(validateState(fixture).valid, true, JSON.stringify(validateState(fixture)));
  const completed = fixtures.find(value => value.status === "completed");
  assert.equal(validateState({ ...completed, version: 2 }).valid, false);
  assert.equal(validateState({ ...completed, threadId: "../escape" }).valid, false);
  assert.equal(validateState({ ...completed, cliStatus: "ERROR" }).valid, false);
  assert.equal(validateState({ ...completed, permissionDenied: true }).valid, false);
  assert.equal(validateState({ ...completed, text: "" }).valid, false);
  assert.equal(validateState({ ...completed, apiKey: "must-never-be-stored" }).valid, false);
  const failed = fixtures.find(value => value.status === "failed");
  const legacy = { ...failed }; delete legacy.toolFailures;
  assert.equal(validateState(legacy).valid, true);
  const withInput = fixtures.find(value => Object.hasOwn(value, "inputText"));
  assert.ok(withInput);
  assert.equal(validateState({ ...withInput, inputText: null }).valid, false);
  assert.equal(validateState({ ...withInput, inputText: 123 }).valid, false);
});

test("actual serialized threads and successful turns satisfy the state contract", async () => {
  const f = await setup();
  await callPeerMessage(f.peerConfig, { peerId: "gemini", message: "Review the task", waitForCompletion: true, waitWindowSeconds: 2 });
  for (const value of [...f.server.list("threads"), ...f.server.list("turns")]) {
    assert.equal(validateState(value).valid, true, JSON.stringify(validateState(value)));
  }
});
