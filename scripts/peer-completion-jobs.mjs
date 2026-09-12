import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { deliverCompletion, validateQueueSupport } from "./peer-completion-delivery.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["completed", "attention", "dispatch_failed"]);
const MAX_JOB_BYTES = 512 * 1024;

export function completionDirectory(settings = {}, env = process.env) {
  return path.resolve(settings.stateDir || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".codex-peer", "jobs"));
}

function requireUUID(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

export function completionJobPath(runId, settings = {}, env = process.env) {
  return path.join(completionDirectory(settings, env), `${requireUUID(runId, "runId")}.json`);
}

function readState(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOB_BYTES) throw new Error("Invalid completion job file.");
  const state = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (state.schemaVersion !== 1 || !UUID.test(state.runId || "") || path.basename(filename) !== `${state.runId}.json`) {
    throw new Error("Unsupported completion job schema or ID.");
  }
  return state;
}

export function writeCompletionState(filename, state) {
  const text = encodeState(state);
  const temp = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
  fs.renameSync(temp, filename);
}

function encodeState(state, maxBytes = MAX_JOB_BYTES) {
  const text = JSON.stringify(state, null, 2) + "\n";
  if (Buffer.byteLength(text) > maxBytes) throw new Error("Completion job exceeds size limit.");
  return text;
}

function boundedResult(result) {
  if (Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024) return result;
  return {
    ok: result.ok === true, turnCompleted: result.turnCompleted === true,
    turnSucceeded: typeof result.turnSucceeded === "boolean" ? result.turnSucceeded : null,
    threadId: typeof result.threadId === "string" ? result.threadId.slice(0, 200) : null,
    turnId: typeof result.turnId === "string" ? result.turnId.slice(0, 200) : null,
    turnStatus: String(result.turnStatus || "unknown").slice(0, 100),
    finalText: String(result.finalText || result.latestText || "").slice(0, 8000),
    resultTruncated: true,
    warnings: ["Large result was truncated. Read the saved peer thread for the full result; do not resend the task."]
  };
}

function liveOwner(filename) {
  if (!fs.existsSync(filename)) return false;
  const pid = Number(fs.readFileSync(filename, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

export function readCompletionJob(runId, settings = {}, options = {}) {
  const receiptPath = completionJobPath(runId, settings, options.env);
  const state = readState(receiptPath);
  let workerAlive = null;
  if (!TERMINAL.has(state.status) && state.workerPid) {
    try { process.kill(state.workerPid, 0); workerAlive = true; }
    catch (error) { workerAlive = error.code === "EPERM"; }
  }
  return {
    ok: true, runId: state.runId, receiptPath,
    status: workerAlive === false ? "worker_unavailable" : state.status,
    peerId: state.peerId, parentThreadId: state.parentThreadId,
    threadId: state.threadId || null, turnId: state.turnId || null,
    result: state.result || null, delivery: state.delivery,
    workerAlive, createdAt: state.createdAt, updatedAt: state.updatedAt,
    warnings: workerAlive === false ? ["Worker is unavailable. Do not resend the task; inspect the saved peer thread first."] : []
  };
}

export async function dispatchCompletionJob(config, toolName, args, options = {}) {
  const env = options.env || process.env;
  const settings = config.completion || {};
  const parentThreadId = requireUUID(args.parentThreadId || env.CODEX_THREAD_ID, "parentThreadId");
  if (env.CODEX_THREAD_ID && parentThreadId !== env.CODEX_THREAD_ID) {
    throw new Error("Completion destination must be the calling Codex task.");
  }
  if (!config.peers?.[args.peerId]) throw new Error("Unknown completion peer.");
  if (typeof args.message !== "string" || !args.message.trim() || Buffer.byteLength(args.message) > 128 * 1024) {
    throw new Error("Peer message must be nonempty and at most 128 KiB.");
  }
  if (args.waitForCompletion === true) throw new Error("notifyParent and waitForCompletion cannot both be true.");
  const configPath = path.resolve(options.configPath || env.CODEX_PEER_CONFIG || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".codex-peer", "peers.json"));
  if (!fs.existsSync(configPath)) throw new Error("Background notifications require a saved peer config.");
  const codexBin = settings.codexBin;
  await (options.validateQueueSupport || validateQueueSupport)({ codexBin });
  const workerEntrypoint = options.workerEntrypoint;
  if (!path.isAbsolute(workerEntrypoint || "") || !fs.existsSync(workerEntrypoint)) throw new Error("Completion worker entrypoint is unavailable.");
  const runId = randomUUID();
  const receiptPath = completionJobPath(runId, settings, env);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  const request = Object.fromEntries(Object.entries(args).filter(([key]) => !["notifyParent", "parentThreadId", "waitForCompletion", "waitWindowSeconds"].includes(key)));
  const state = {
    schemaVersion: 1, runId, parentThreadId, peerId: args.peerId,
    configPath, codexBin, toolName, request,
    status: "registered", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    delivery: { status: "pending", attempts: 0 }
  };
  // Leave room for execution IDs, status and failure diagnostics after registration.
  fs.writeFileSync(receiptPath, encodeState(state, 256 * 1024), { flag: "wx", mode: 0o600 });
  const spawnImpl = options.spawnImpl || spawn;
  try {
    const child = spawnImpl(process.execPath, [workerEntrypoint, "--completion-job", receiptPath], {
      detached: true, stdio: "ignore", windowsHide: true, shell: false, env
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.unref();
    // The worker is the only writer after spawn; do not overwrite a fast completion.
  } catch {
    state.status = "dispatch_failed";
    state.request = null;
    state.updatedAt = new Date().toISOString();
    state.result = { ok: false, peerTurnStarted: false, turnCompleted: false, error: "Background worker could not start." };
    writeCompletionState(receiptPath, state);
    return { ok: false, runId, receiptPath, peerTurnStarted: false, error: "Background worker could not start. No peer task was sent." };
  }
  return {
    ok: true, runId, receiptPath, peerId: args.peerId, parentThreadId,
    turnCompleted: false,
    notification: { mode: "push", status: "registered" },
    message: "Background job accepted. Continue independent work or end this turn. A single completion/attention notice will be queued; do not poll or resend."
  };
}

export async function runCompletionJob(receiptPath, options) {
  if (!path.isAbsolute(receiptPath || "")) throw new Error("Completion job path must be absolute.");
  const state = readState(receiptPath);
  const lockPath = `${receiptPath}.lock`;
  if (state.status !== "registered") {
    if (!TERMINAL.has(state.status) || state.delivery.status !== "pending" || liveOwner(lockPath)) {
      return { skipped: true, status: state.status };
    }
    // A saved terminal result with no delivery attempt can be recovered without executing the child again.
    return notifySavedResult(receiptPath, state, options);
  }
  try { fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code === "EEXIST") return { skipped: true, status: "claimed" }; throw error; }
  // Keep the one-shot claim even after completion/crash. Recovery must never replay turn/start.
  state.workerPid = process.pid;
  state.status = "starting";
  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeCompletionState(receiptPath, state);
  };
  save();
  try {
    const config = options.loadConfig(state.configPath);
    const result = await options.run(config, state.toolName, {
      ...state.request, notifyParent: false, waitForCompletion: true,
      // This is an event wait in a detached program, not a model/tool polling loop.
      waitWindowSeconds: 24 * 60 * 60
    }, {
      onBeforeTurnStart: async ({ threadId }) => {
        state.threadId = threadId;
        state.status = "sending";
        save();
      },
      onTurnStarted: async ({ threadId, turnId }) => {
        state.threadId = threadId;
        state.turnId = turnId;
        state.status = "running";
        state.request = null;
        save();
      }
    });
    state.result = boundedResult(result);
    state.threadId = result.threadId || state.threadId || null;
    state.turnId = result.turnId || state.turnId || null;
    state.status = result.turnCompleted ? "completed" : "attention";
  } catch {
    state.result = {
      ok: false, turnCompleted: false, turnSucceeded: null,
      peerTurnStarted: ["sending", "running"].includes(state.status) ? null : false,
      error: "Peer connection or worker failed. Delivery/execution may be uncertain; inspect the saved peer IDs without resending."
    };
    state.status = "attention";
  }
  state.request = null;
  save();
  return notifySavedResult(receiptPath, state, options);
}

async function notifySavedResult(receiptPath, state, options) {
  // This permanent claim is shared by normal execution and crash recovery.
  // Never reclaim it, even for a dead PID: a queue acknowledgement may have been lost.
  try { fs.writeFileSync(`${receiptPath}.delivery-attempt`, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code === "EEXIST") return { skipped: true, status: "delivery_claimed" }; throw error; }
  state = readState(receiptPath);
  if (state.delivery.status !== "pending") return { skipped: true, status: state.delivery.status };
  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeCompletionState(receiptPath, state);
  };
  // Write before sending. An uncertain queue acknowledgement must never trigger an automatic retry.
  state.delivery = { status: "sending", attempts: 1, attemptedAt: new Date().toISOString() };
  save();
  try {
    const delivered = await (options.deliverCompletion || deliverCompletion)({
      codexBin: state.codexBin, parentThreadId: state.parentThreadId,
      runId: state.runId, receiptPath
    });
    state.delivery = { ...state.delivery, ...delivered };
  } catch (error) {
    state.delivery.status = error.uncertain === false ? "failed" : "uncertain";
    state.delivery.error = "Completion delivery was not confirmed. Do not retry automatically.";
  }
  save();
  return { status: state.status, delivery: state.delivery };
}
