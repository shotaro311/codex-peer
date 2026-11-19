import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { completionJobPath, dispatchCompletionJob, readCompletionJob, runCompletionJob } from "../scripts/peer-completion-jobs.mjs";

const directories = [];
const validateState = new AjvJsonSchemaValidator().getValidator(JSON.parse(fs.readFileSync(new URL("../schemas/completion-job.schema.json", import.meta.url))));
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-completion-test-")); directories.push(dir);
  const configPath = path.join(dir, "peers.json");
  const config = { peers: { gemini: {} }, completion: { stateDir: dir, codexBin: process.execPath } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const parentThreadId = randomUUID();
  const options = {
    configPath, env: { CODEX_THREAD_ID: parentThreadId }, workerEntrypoint: import.meta.filename,
    validateQueueSupport: async () => ({ supported: true }),
    spawnImpl: (_command, _args, spawnOptions) => {
      assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.windowsHide, true);
      assert.equal(spawnOptions.detached, true); assert.equal(spawnOptions.stdio, "ignore");
      const child = new EventEmitter(); child.unref = () => {};
      process.nextTick(() => child.emit("spawn")); return child;
    }
  };
  return { config, options, parentThreadId, dir };
}

test("dispatch stores a private request but never passes prompt or credentials on argv", async () => {
  const f = fixture(); const original = f.options.spawnImpl;
  f.options.spawnImpl = (command, args, options) => {
    assert.equal(args.includes("private test input"), false);
    return original(command, args, options);
  };
  const result = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "private test input", notifyParent: true }, f.options);
  assert.equal(result.notification.mode, "push"); assert.equal(result.turnCompleted, false);
  const read = readCompletionJob(result.runId, f.config.completion);
  assert.equal(read.status, "registered"); assert.equal(read.request, undefined);
  if (process.platform !== "win32") assert.equal(fs.statSync(result.receiptPath).mode & 0o777, 0o600);
});

test("invalid parent and unsupported queue stop before starting any peer", async () => {
  const f = fixture(); let launches = 0;
  f.options.spawnImpl = () => { launches++; };
  await assert.rejects(dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test", parentThreadId: randomUUID() }, f.options), /calling Codex task/);
  f.options.validateQueueSupport = async () => { throw new Error("unsupported"); };
  await assert.rejects(dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options), /unsupported/);
  assert.equal(launches, 0);
});

test("dispatch rejects requests exceeding 512 KiB after JSON escaping without registering or starting work", async () => {
  const f = fixture(); let launches = 0;
  f.options.spawnImpl = () => { launches++; throw new Error("must not start"); };
  const message = "\u0001".repeat(96 * 1024);
  assert.ok(Buffer.byteLength(message) < 128 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify({ message })) > 512 * 1024);
  await assert.rejects(dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message }, f.options), /size limit/);
  assert.equal(launches, 0);
  assert.deepEqual(fs.readdirSync(f.dir), ["peers.json"]);
});

test("registration leaves space below the receipt limit for worker IDs and later state changes", async () => {
  const f = fixture(); let launches = 0;
  f.options.spawnImpl = () => { launches++; throw new Error("must not start"); };
  const message = "\u0001".repeat(45 * 1024);
  const encodedBytes = Buffer.byteLength(JSON.stringify({ message }));
  assert.ok(Buffer.byteLength(message) < 128 * 1024);
  assert.ok(encodedBytes > 256 * 1024 && encodedBytes < 512 * 1024);
  await assert.rejects(dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message }, f.options), /size limit/);
  assert.equal(launches, 0);
  assert.deepEqual(fs.readdirSync(f.dir), ["peers.json"]);
});

test("a worker waits for one result without polling and delivers exactly one attempt", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  let finish; const completed = new Promise(resolve => { finish = resolve; });
  let runCalls = 0; let deliveries = 0;
  const threadId = randomUUID(), turnId = randomUUID();
  const execution = runCompletionJob(job.receiptPath, {
    loadConfig: () => f.config,
    run: async (_config, _name, args, hooks) => {
      runCalls++;
      assert.equal(args.notifyParent, false); assert.equal(args.waitForCompletion, true);
      await hooks.onBeforeTurnStart({ threadId }); await hooks.onTurnStarted({ threadId, turnId });
      return completed;
    },
    deliverCompletion: async input => {
      deliveries++;
      const saved = JSON.parse(fs.readFileSync(input.receiptPath));
      assert.equal(saved.delivery.status, "sending"); assert.equal(saved.request, null);
      assert.equal(saved.result.turnSucceeded, true);
      return { status: "queued", queuedSubmissionId: randomUUID() };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runCalls, 1); assert.equal(deliveries, 0);
  assert.equal(readCompletionJob(job.runId, f.config.completion).status, "running");
  finish({ ok: true, threadId, turnId, turnCompleted: true, turnSucceeded: true, finalText: "done" });
  await execution;
  const valid = validateState(JSON.parse(fs.readFileSync(job.receiptPath)));
  assert.equal(valid.valid, true, valid.errorMessage);
  await runCompletionJob(job.receiptPath, { loadConfig: () => { throw new Error("must not reload"); } });
  assert.equal(runCalls, 1); assert.equal(deliveries, 1);
});

test("uncertain delivery is persisted and never retried on restart", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  let deliveries = 0;
  const opts = { loadConfig: () => f.config, run: async () => ({ turnCompleted: true, turnSucceeded: false }),
    deliverCompletion: async () => { deliveries++; throw Object.assign(new Error("secret diagnostic"), { uncertain: true }); } };
  await runCompletionJob(job.receiptPath, opts);
  await runCompletionJob(job.receiptPath, opts);
  assert.equal(deliveries, 1);
  const saved = readCompletionJob(job.runId, f.config.completion);
  assert.equal(saved.delivery.status, "uncertain");
  assert.equal(JSON.stringify(saved).includes("secret diagnostic"), false);
});

test("large results retain terminal evidence in a bounded receipt before notification", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const threadId = randomUUID(), turnId = randomUUID();
  const result = {
    ok: true, threadId, turnId, turnCompleted: true, turnSucceeded: true, turnStatus: "completed",
    finalText: "\u0001".repeat(96 * 1024),
    rawEvents: [{ detail: "x".repeat(512 * 1024) }]
  };
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > 512 * 1024);
  let deliveries = 0;
  await runCompletionJob(job.receiptPath, {
    loadConfig: () => f.config,
    run: async (_config, _name, _args, hooks) => {
      await hooks.onBeforeTurnStart({ threadId }); await hooks.onTurnStarted({ threadId, turnId });
      return result;
    },
    deliverCompletion: async ({ receiptPath }) => {
      deliveries++;
      const saved = JSON.parse(fs.readFileSync(receiptPath));
      assert.equal(saved.status, "completed");
      assert.equal(saved.request, null);
      assert.equal(saved.result.turnSucceeded, true);
      assert.equal(saved.delivery.status, "sending");
      assert.ok(fs.statSync(receiptPath).size <= 512 * 1024);
      return { status: "queued", queuedSubmissionId: randomUUID() };
    }
  });
  const saved = readCompletionJob(job.runId, f.config.completion);
  assert.equal(saved.status, "completed");
  assert.equal(saved.threadId, threadId); assert.equal(saved.turnId, turnId);
  assert.equal(saved.result.resultTruncated, true);
  assert.ok(saved.result.finalText.length > 0 && saved.result.finalText.length < result.finalText.length);
  assert.equal(saved.result.rawEvents, undefined);
  assert.equal(saved.delivery.status, "queued"); assert.equal(deliveries, 1);
  const valid = validateState(JSON.parse(fs.readFileSync(job.receiptPath)));
  assert.equal(valid.valid, true, valid.errorMessage);
});

test("a terminal receipt with a dead execution owner recovers one notification without rerunning the peer", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const formerWorker = spawnSync(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
  assert.equal(formerWorker.status, 0);
  assert.throws(() => process.kill(formerWorker.pid, 0), { code: "ESRCH" });
  const state = JSON.parse(fs.readFileSync(job.receiptPath));
  const result = { ok: true, turnCompleted: true, turnSucceeded: true, finalText: "saved before worker exit" };
  Object.assign(state, { status: "completed", request: null, workerPid: formerWorker.pid, result });
  fs.writeFileSync(job.receiptPath, JSON.stringify(state));
  fs.writeFileSync(`${job.receiptPath}.lock`, String(formerWorker.pid));
  let peerCalls = 0; let deliveries = 0;
  const options = {
    loadConfig: () => { peerCalls++; throw new Error("must not reload the peer"); },
    run: async () => { peerCalls++; throw new Error("must not rerun the peer"); },
    deliverCompletion: async ({ runId, receiptPath }) => {
      deliveries++;
      assert.equal(runId, job.runId); assert.equal(receiptPath, job.receiptPath);
      const saved = JSON.parse(fs.readFileSync(receiptPath));
      assert.equal(saved.delivery.status, "sending"); assert.equal(saved.delivery.attempts, 1);
      assert.deepEqual(saved.result, result);
      return { status: "queued", queuedSubmissionId: randomUUID() };
    }
  };
  await Promise.all([runCompletionJob(job.receiptPath, options), runCompletionJob(job.receiptPath, options)]);
  await runCompletionJob(job.receiptPath, options);
  assert.equal(peerCalls, 0); assert.equal(deliveries, 1);
  const saved = readCompletionJob(job.runId, f.config.completion);
  assert.equal(saved.status, "completed"); assert.equal(saved.delivery.status, "queued");
  assert.equal(saved.delivery.attempts, 1); assert.deepEqual(saved.result, result);
});

test("terminal pending delivery stays untouched while its execution owner is alive", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const state = JSON.parse(fs.readFileSync(job.receiptPath));
  Object.assign(state, { status: "completed", request: null, workerPid: process.pid, result: { turnCompleted: true } });
  const before = JSON.stringify(state);
  fs.writeFileSync(job.receiptPath, before);
  fs.writeFileSync(`${job.receiptPath}.lock`, String(process.pid));
  let calls = 0;
  const refuse = () => { calls++; throw new Error("active worker owns this delivery"); };
  const result = await runCompletionJob(job.receiptPath, { loadConfig: refuse, run: refuse, deliverCompletion: refuse });
  assert.equal(result.skipped, true); assert.equal(calls, 0);
  assert.equal(fs.readFileSync(job.receiptPath, "utf8"), before);
});

test("a dead sender's permanent claim prevents retry even if the receipt still says pending", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const formerWorker = spawnSync(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
  assert.equal(formerWorker.status, 0);
  assert.throws(() => process.kill(formerWorker.pid, 0), { code: "ESRCH" });
  const state = JSON.parse(fs.readFileSync(job.receiptPath));
  Object.assign(state, { status: "completed", request: null, workerPid: formerWorker.pid, result: { turnCompleted: true } });
  const before = JSON.stringify(state);
  fs.writeFileSync(job.receiptPath, before);
  fs.writeFileSync(`${job.receiptPath}.lock`, String(formerWorker.pid));
  fs.writeFileSync(`${job.receiptPath}.delivery-attempt`, String(formerWorker.pid));
  let calls = 0;
  const refuse = () => { calls++; throw new Error("previous sender may already have queued the notification"); };
  const options = { loadConfig: refuse, run: refuse, deliverCompletion: refuse };
  await runCompletionJob(job.receiptPath, options);
  await runCompletionJob(job.receiptPath, options);
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(job.receiptPath, "utf8"), before);
  assert.equal(fs.readFileSync(`${job.receiptPath}.delivery-attempt`, "utf8"), String(formerWorker.pid));
});

test("a stale pending snapshot cannot overwrite a delivery already queued on disk", async (t) => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const state = JSON.parse(fs.readFileSync(job.receiptPath));
  Object.assign(state, { status: "completed", request: null, result: { turnCompleted: true } });
  const stalePending = JSON.stringify(state);
  state.delivery = { status: "queued", attempts: 1, queuedSubmissionId: randomUUID() };
  const savedQueued = JSON.stringify(state);
  fs.writeFileSync(job.receiptPath, savedQueued);
  const originalRead = fs.readFileSync;
  let staleReads = 0;
  t.mock.method(fs, "readFileSync", function(filename, ...args) {
    if (filename === job.receiptPath && staleReads++ === 0) return stalePending;
    return originalRead.call(this, filename, ...args);
  });
  let calls = 0;
  const refuse = () => { calls++; throw new Error("the notification is already queued"); };
  const result = await runCompletionJob(job.receiptPath, { loadConfig: refuse, run: refuse, deliverCompletion: refuse });
  assert.equal(result.skipped, true); assert.equal(calls, 0);
  assert.equal(fs.readFileSync(job.receiptPath, "utf8"), savedQueued);
});

test("lost connection after send preserves child IDs and notifies attention without resend", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  const threadId = randomUUID(); let runs = 0;
  await runCompletionJob(job.receiptPath, {
    loadConfig: () => f.config,
    run: async (_c, _n, _a, hooks) => { runs++; await hooks.onBeforeTurnStart({ threadId }); throw new Error("lost"); },
    deliverCompletion: async () => ({ status: "queued", queuedSubmissionId: randomUUID() })
  });
  const saved = readCompletionJob(job.runId, f.config.completion);
  assert.equal(saved.status, "attention"); assert.equal(saved.threadId, threadId);
  assert.equal(saved.result.peerTurnStarted, null); assert.equal(runs, 1);
});

test("duplicate worker claims never issue a second turn", async () => {
  const f = fixture();
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  fs.writeFileSync(`${job.receiptPath}.lock`, "existing worker");
  const result = await runCompletionJob(job.receiptPath, { loadConfig: () => { throw new Error("must not start"); } });
  assert.equal(result.skipped, true);
});

test("spawn errors are reported as no peer task sent", async () => {
  const f = fixture();
  f.options.spawnImpl = () => { const child = new EventEmitter(); process.nextTick(() => child.emit("error", new Error("failed"))); return child; };
  const job = await dispatchCompletionJob(f.config, "peer_message", { peerId: "gemini", message: "test" }, f.options);
  assert.equal(job.ok, false); assert.equal(job.peerTurnStarted, false);
  assert.equal(readCompletionJob(job.runId, f.config.completion).status, "dispatch_failed");
});

test("read refuses path traversal and preserves a legacy caller without notification", () => {
  assert.throws(() => completionJobPath("../elsewhere"), /UUID/);
});

test("versioned fixture rejects incompatible state and duplicate delivery attempts", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("fixtures/completion-job.json", import.meta.url)));
  assert.equal(validateState(fixture).valid, true);
  assert.equal(validateState({ ...fixture, schemaVersion: 2 }).valid, false);
  assert.equal(validateState({ ...fixture, request: { message: "retained private prompt" } }).valid, false);
  assert.equal(validateState({ ...fixture, delivery: { ...fixture.delivery, attempts: 2 } }).valid, false);
  assert.equal(validateState({ ...fixture, delivery: { status: "queued", attempts: 1 } }).valid, false);
});
