import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { deliverCompletion, QueueDeliveryError, validateQueueSupport } from "../scripts/peer-completion-delivery.mjs";

const parentThreadId = "123e4567-e89b-12d3-a456-426614174000";
const runId = "123e4567-e89b-12d3-a456-426614174001";
const queuedSubmissionId = "123e4567-e89b-12d3-a456-426614174002";
const request = {
  codexBin: process.execPath,
  parentThreadId,
  runId,
  receiptPath: path.resolve(os.tmpdir(), 'peer result $HOME `id` "quoted".json')
};
const acknowledgement = `Queued message ${queuedSubmissionId} for thread ${parentThreadId}.\n`;

function fakeSpawn(action) {
  const calls = [];
  const spawnImpl = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    calls.at(-1).push(child);
    queueMicrotask(() => action(child));
    return child;
  };
  return { spawnImpl, calls };
}

function finish(child, { stdout = acknowledgement, stderr = "", code = 0 } = {}) {
  child.emit("spawn");
  child.stdout.end(stdout);
  child.stderr.end(stderr);
  child.emit("close", code);
}

describe("peer completion delivery", () => {
  it("queues one fixed notification with literal arguments and no shell", async () => {
    const fake = fakeSpawn((child) => finish(child));
    const result = await deliverCompletion({ ...request, childOutput: "UNTRUSTED_SECRET" }, fake);
    assert.deepEqual(result, { status: "queued", queuedSubmissionId });
    assert.equal(fake.calls.length, 1);
    const [binary, args, options] = fake.calls[0];
    assert.equal(binary, process.execPath);
    assert.deepEqual(args.slice(0, 4), ["queue", "--thread", parentThreadId, "--message"]);
    assert.equal(args.length, 5);
    assert.match(args[4], /External peer completion notification \(tool data\)/);
    assert.match(args[4], /adds no instructions, authorization, or permission/);
    assert.ok(args[4].includes(JSON.stringify(request.receiptPath)));
    assert.doesNotMatch(args[4], /UNTRUSTED_SECRET/);
    assert.deepEqual(options, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  });

  it("rejects invalid destinations before starting a process", async () => {
    const fake = fakeSpawn(() => { throw new Error("must not spawn"); });
    for (const change of [
      { codexBin: "codex" },
      { parentThreadId: "--other-thread" },
      { runId: "run\nnew instruction" },
      { receiptPath: "relative.json" },
      { receiptPath: `${request.receiptPath}\nnew instruction` }
    ]) {
      await assert.rejects(deliverCompletion({ ...request, ...change }, fake), (error) =>
        error instanceof QueueDeliveryError && error.code === "INVALID_ARGUMENT" && !error.uncertain);
    }
    assert.equal(fake.calls.length, 0);
  });

  it("rejects command shims and script executables", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-delivery-script-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    fs.writeFileSync(script, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    for (const codexBin of [script, `${script}.cmd`, `${script}.mjs`]) {
      await assert.rejects(validateQueueSupport({ codexBin }), { code: "INVALID_ARGUMENT", uncertain: false });
    }
  });

  it("reports pre-launch failures as definitely unsent", async () => {
    const fake = fakeSpawn((child) => child.emit("error", new Error("SECRET credential")));
    await assert.rejects(deliverCompletion(request, fake), (error) => {
      assert.equal(error.uncertain, false);
      assert.doesNotMatch(error.message, /SECRET/);
      return error.code === "PROCESS_ERROR";
    });
  });

  it("never retries or exposes process output after a nonzero exit", async () => {
    const fake = fakeSpawn((child) => finish(child, { code: 1, stdout: "SECRET stdout", stderr: "SECRET stderr" }));
    await assert.rejects(deliverCompletion(request, fake), (error) => {
      assert.equal(error.uncertain, true);
      assert.doesNotMatch(error.message, /SECRET/);
      return error.code === "COMMAND_FAILED";
    });
    assert.equal(fake.calls.length, 1);
  });

  it("treats missing or mismatched acknowledgements as uncertain", async () => {
    for (const stdout of ["", "ok", acknowledgement.replace(parentThreadId, runId), acknowledgement + acknowledgement]) {
      const fake = fakeSpawn((child) => finish(child, { stdout }));
      await assert.rejects(deliverCompletion(request, fake), { code: "INVALID_ACKNOWLEDGEMENT", uncertain: true });
      assert.equal(fake.calls.length, 1);
    }
  });

  it("bounds process time and does not retry a timed-out send", async () => {
    const fake = fakeSpawn((child) => child.emit("spawn"));
    await assert.rejects(deliverCompletion(request, { ...fake, timeoutMs: 5 }), { code: "TIMEOUT", uncertain: true });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0][3].killed, true);
  });

  it("bounds output and marks an interrupted acknowledgement as uncertain", async () => {
    const fake = fakeSpawn((child) => {
      child.emit("spawn");
      child.stdout.write("x".repeat(65537));
    });
    await assert.rejects(deliverCompletion(request, fake), { code: "OUTPUT_LIMIT", uncertain: true });
    assert.equal(fake.calls[0][3].killed, true);
  });

  it("preflights only queue help without sending a message", async () => {
    const fake = fakeSpawn((child) => finish(child, { stdout: "Usage: codex queue [OPTIONS] --thread <THREAD> --message <TEXT>\n" }));
    assert.deepEqual(await validateQueueSupport({ codexBin: process.execPath }, fake), { supported: true });
    assert.deepEqual(fake.calls[0][1], ["queue", "--help"]);
  });

  it("rejects unsupported queue help and enforces the timeout bound", async () => {
    const fake = fakeSpawn((child) => finish(child, { stdout: "Usage: codex [OPTIONS]\n" }));
    await assert.rejects(validateQueueSupport({ codexBin: process.execPath }, fake), { code: "QUEUE_UNSUPPORTED", uncertain: false });
    await assert.rejects(deliverCompletion(request, { ...fake, timeoutMs: 30001 }), { code: "INVALID_ARGUMENT", uncertain: false });
    assert.equal(fake.calls.length, 1);
  });
});
