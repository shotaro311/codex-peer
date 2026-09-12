#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { createHistoryHandler } from "./gemini-peer-history.mjs";

export const VERSION = "0.1.0";
export const MODELS = ["gemini-3.8-flash-medium", "gemini-3.8-flash-high"];
const MODES = { "read-only": "plan", "workspace-write": "accept-edits" };
const MAX_OUTPUT = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function normalizeConfig(raw = {}, env = process.env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const stateDir = path.resolve(raw.stateDir || path.join(home, ".gemini-peer"));
  const defaultCwd = path.resolve(raw.defaultCwd || path.join(stateDir, "workspace"));
  const config = {
    stateDir, defaultCwd,
    allowedRoots: (raw.allowedRoots || [defaultCwd]).map(root => path.resolve(root)),
    agyBin: raw.agyBin || (platform === "win32"
      ? path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "agy", "bin", "agy.exe")
      : path.join(home, ".local", "bin", "agy")),
    settingsFile: path.join(home, ".gemini", "antigravity-cli", "settings.json"),
    authTokenFile: raw.authTokenFile,
    model: raw.model || MODELS[0],
    executionMode: raw.executionMode || "read-only",
    timeoutMs: raw.timeoutMs ?? 30 * 60 * 1000,
    maxConcurrentTurns: raw.maxConcurrentTurns ?? 2,
    listen: { host: raw.listen?.host || "127.0.0.1", port: raw.listen?.port ?? 17848 }
  };
  if (!MODELS.includes(config.model)) throw new Error("Only Gemini 3.8 Flash medium/high models are supported.");
  if (!MODES[config.executionMode]) throw new Error("Invalid executionMode.");
  if (!["127.0.0.1", "::1"].includes(config.listen.host)) throw new Error("Gemini Peer must listen on loopback; use an authenticated tunnel for remote access.");
  if (!Number.isInteger(config.listen.port) || config.listen.port < 0 || config.listen.port > 65535) throw new Error("Invalid listen port.");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 86400000) throw new Error("Invalid timeoutMs.");
  if (!Number.isInteger(config.maxConcurrentTurns) || config.maxConcurrentTurns < 1 || config.maxConcurrentTurns > 8) throw new Error("Invalid maxConcurrentTurns.");
  if (!config.authTokenFile) throw new Error("authTokenFile is required, including for loopback.");
  if (!config.allowedRoots.length) throw new Error("At least one allowedRoots entry is required.");
  return config;
}

export function subscriptionEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GEMINI_BASE_URL|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI)$/i.test(key)));
}

export function checkSubscriptionSettings(config) {
  if (!fs.existsSync(config.settingsFile)) return;
  const settings = JSON.parse(fs.readFileSync(config.settingsFile, "utf8"));
  if (settings.modelProvider) throw new Error("API/custom modelProvider is configured. Gemini Peer requires official account authentication; settings were not changed.");
  if (settings.useG1Credits != null && settings.useG1Credits !== false) throw new Error("Additional AI credits fallback is enabled or unrecognized. Gemini Peer requires no additional credits fallback; settings were not changed.");
}

export function buildAgyArgs(config, conversationId, executionMode = config.executionMode) {
  if (!MODES[executionMode]) throw new Error("Invalid executionMode.");
  const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--model", config.model,
    "--mode", MODES[executionMode], "--print-timeout", `${config.timeoutMs}ms`];
  if (conversationId) {
    if (!UUID.test(conversationId)) throw new Error("Invalid saved conversation ID.");
    args.push("--conversation", conversationId);
  }
  return args;
}

function atomicWrite(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

export class GeminiPeerServer {
  constructor(config, options = {}) {
    this.config = config;
    this.env = options.env || process.env;
    this.spawn = options.spawn || spawn;
    this.clients = new Set();
    this.running = new Map();
    this.closed = false;
  }

  file(kind, id) {
    if (!UUID.test(id || "")) throw new Error("Invalid peer state ID.");
    return path.join(this.config.stateDir, kind, `${id}.json`);
  }

  read(kind, id) {
    const result = JSON.parse(fs.readFileSync(this.file(kind, id), "utf8"));
    if (result.version !== 1) throw new Error("Unsupported Gemini Peer state version.");
    return result;
  }

  save(kind, value) { atomicWrite(this.file(kind, value.id), { ...value, version: 1 }); }

  list(kind) {
    return fs.readdirSync(path.join(this.config.stateDir, kind)).filter(name => UUID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
      .map(name => this.read(kind, name.slice(0, -5)));
  }

  cwd(value) {
    const cwd = fs.realpathSync(value || this.config.defaultCwd);
    if (!fs.statSync(cwd).isDirectory()) throw new Error("cwd is not a directory.");
    const allowed = this.config.allowedRoots.some(root => {
      const relative = path.relative(fs.realpathSync(root), cwd);
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    });
    if (!allowed) throw new Error("cwd is outside the configured delegation roots.");
    return cwd;
  }

  wire(turn) {
    return { id: turn.id, threadId: turn.threadId, status: turn.status, error: turn.error || null,
      startedAt: turn.startedAt, completedAt: turn.completedAt || null,
      items: [
        ...(typeof turn.inputText === "string" ? [{ id: `${turn.id}-input`, type: "userMessage", content: [{ type: "text", text: turn.inputText }] }] : []),
        ...(turn.text ? [{ type: "agentMessage", text: turn.text }] : [])
      ],
      gemini: { model: turn.model, executionMode: turn.executionMode, cliStatus: turn.cliStatus || null,
        permissionDenied: !!turn.permissionDenied, toolError: !!turn.toolError,
        toolFailures: turn.toolFailures || [],
        taskCompletion: "requires-parent-readback" } };
  }

  turns(threadId, limit = 20) {
    this.read("threads", threadId);
    return this.list("turns").filter(turn => turn.threadId === threadId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.max(1, Math.min(100, limit))).map(turn => this.wire(turn));
  }

  broadcast(method, params) {
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(JSON.stringify({ method, params }));
  }

  handleRequest(method, params = {}) {
    switch (method) {
      case "initialize":
        return { platformOs: process.platform, platformFamily: process.platform === "win32" ? "windows" : "unix",
          userAgent: `gemini-peer-server/${VERSION}`, serverInfo: { name: "gemini-peer-server", version: VERSION },
          gemini: { configuredModel: this.config.model, authenticationVerified: false, modelAvailabilityVerified: false } };
      case "thread/start": {
        const now = new Date().toISOString();
        const thread = { version: 1, id: randomUUID(), cwd: this.cwd(params.cwd), conversationId: null,
          createdAt: now, updatedAt: now, preview: "", status: "idle" };
        this.save("threads", thread);
        return { thread };
      }
      case "thread/resume": return { thread: this.read("threads", params.threadId) };
      case "thread/read": return { thread: { ...this.read("threads", params.threadId), turns: this.turns(params.threadId, 100) } };
      case "thread/turns/list": return { data: this.turns(params.threadId, params.limit) };
      case "thread/list": return { data: this.list("threads").filter(t => !params.cwd || t.cwd === path.resolve(params.cwd))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(100, params.limit || 20))) };
      case "turn/start": return this.startTurn(params);
      default: throw new Error("Unsupported Gemini Peer method.");
    }
  }

  startTurn(params) {
    if (this.closed) throw new Error("Gemini Peer is shutting down.");
    const thread = this.read("threads", params.threadId);
    if (this.running.has(thread.id)) throw new Error("This Gemini thread already has a running turn; do not resend.");
    if (this.running.size >= this.config.maxConcurrentTurns) throw new Error("Gemini Peer concurrent turn limit reached.");
    if (!Array.isArray(params.input) || !params.input.length || params.input.some(item => item.type !== "text" || typeof item.text !== "string")) {
      throw new Error("Gemini Peer accepts text inputs only.");
    }
    const message = params.input.map(item => item.text).join("\n");
    if (!message.trim() || Buffer.byteLength(message) > 512 * 1024) throw new Error("Prompt is empty or exceeds 512 KiB.");
    const executionMode = params.executionMode || this.config.executionMode;
    const args = buildAgyArgs(this.config, thread.conversationId, executionMode);
    checkSubscriptionSettings(this.config);
    this.cwd(thread.cwd);
    const turn = { version: 1, id: randomUUID(), threadId: thread.id, model: this.config.model,
      executionMode, status: "inProgress", startedAt: new Date().toISOString(), inputText: message, text: "", error: null };
    thread.status = "inProgress";
    thread.updatedAt = turn.startedAt;
    thread.preview = thread.preview || message.replace(/\s+/g, " ").slice(0, 160);
    this.save("threads", thread);
    this.save("turns", turn);
    const state = { turn, thread, done: false, child: null, buffer: "", byteCount: 0, init: false, result: null, failure: null };
    this.running.set(thread.id, state);
    this.broadcast("turn/started", { threadId: thread.id, turn: this.wire(turn) });
    try {
      const child = this.spawn(this.config.agyBin, args, { cwd: thread.cwd, env: subscriptionEnv(this.env),
        shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      state.child = child;
      if (Number.isInteger(child.pid)) { turn.runnerPid = child.pid; this.save("turns", turn); }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => this.consume(state, chunk));
      child.stderr.on("data", chunk => {
        // Keep diagnostics private; only preserve classifications, never OAuth URLs or raw stderr.
        state.stderrTail = ((state.stderrTail || "") + chunk).slice(-8192);
        if (/soft.?denied|permission.{0,80}(denied|required)|requires?.{0,40}approval|not (allowed|permitted)/i.test(state.stderrTail)) turn.permissionDenied = true;
      });
      child.on("error", () => { state.failure = "Could not start Antigravity CLI; check installation and local authentication."; this.finish(state, 1); });
      child.stdin.on("error", () => { this.failProcess(state, "Antigravity input pipe failed; delivery may be uncertain. Do not resend automatically."); });
      child.on("close", (code, signal) => {
        if (state.buffer.trim()) this.consumeLine(state, state.buffer);
        if (signal) state.failure ||= "Antigravity process was interrupted.";
        this.finish(state, code);
      });
      state.timer = setTimeout(() => this.failProcess(state, "Gemini turn exceeded its timeout; inspect saved state before retrying."), this.config.timeoutMs + 5000);
      state.timer.unref();
      const instructions = executionMode === "read-only"
        ? "This is a read-only delegation. Analyze and report; do not edit files or execute mutating commands."
        : "Work only on the explicitly delegated files and commands. Report changes, tests and blockers for parent verification.";
      child.stdin.end(JSON.stringify({ event: "user", message: { content: `${instructions}\nDo not delegate to other agents. Do not send external messages or use API credentials. If permissions block work, report the blocker; never claim the blocked action succeeded.\n\n${message}` } }) + "\n");
    } catch {
      state.failure = "Could not start Antigravity CLI.";
      this.finish(state, 1);
    }
    return { turn: this.wire(turn) };
  }

  consume(state, chunk) {
    if (state.done) return;
    state.byteCount += Buffer.byteLength(chunk);
    if (state.byteCount > MAX_OUTPUT) return this.failProcess(state, "Antigravity stream exceeded the output limit.");
    state.buffer += chunk;
    let end;
    while ((end = state.buffer.indexOf("\n")) !== -1) {
      const line = state.buffer.slice(0, end);
      state.buffer = state.buffer.slice(end + 1);
      if (line.trim()) this.consumeLine(state, line);
    }
  }

  consumeLine(state, line) {
    if (state.done || state.failure) return;
    let event;
    try { event = JSON.parse(line); } catch { return this.failProcess(state, "Antigravity emitted invalid stream JSON."); }
    if (event.event === "init") {
      if (state.init || !UUID.test(event.conversation_id || "") || event.init?.model !== this.config.model || event.init?.permission_mode !== "request-review") {
        return this.failProcess(state, "Antigravity initialization did not confirm the pinned model and scoped permissions.");
      }
      if (state.thread.conversationId && state.thread.conversationId !== event.conversation_id) {
        return this.failProcess(state, "Antigravity resumed a different conversation; result rejected.");
      }
      state.init = true;
      state.thread.conversationId = event.conversation_id;
      this.save("threads", state.thread);
    } else if (event.event === "step_update") {
      if (!state.init || state.result) return this.failProcess(state, "Antigravity stream event order was invalid.");
      const step = event.step_update || {};
      if (step.tool_info?.error) {
        state.turn.toolError = true;
        const errorText = String(step.tool_info.error.message || "");
        const requiredPermission = errorText.match(/permission check failed for ([a-z_]+)\b/i)?.[1] || null;
        if (requiredPermission || /user denied permission/i.test(errorText)) state.turn.permissionDenied = true;
        const name = /^[a-z_][a-z0-9_.-]{0,63}$/i.test(step.tool_name || "") ? step.tool_name : "unknown_tool";
        const failure = { name, requiredPermission };
        state.turn.toolFailures ||= [];
        if (state.turn.toolFailures.length < 32 && !state.turn.toolFailures.some(item => item.name === name && item.requiredPermission === requiredPermission)) state.turn.toolFailures.push(failure);
      }
    } else if (event.event === "result") {
      if (state.result) return this.failProcess(state, "Antigravity emitted duplicate terminal results.");
      state.result = event.result;
      if (!state.result || (state.init && state.result.conversation_id !== state.thread.conversationId)) {
        return this.failProcess(state, "Antigravity result conversation did not match the active thread.");
      }
      state.turn.cliStatus = state.result.status;
      state.turn.text = typeof state.result.response === "string" ? state.result.response : "";
      this.save("turns", state.turn);
    } else {
      this.failProcess(state, "Antigravity emitted an unsupported stream event; inspect CLI compatibility.");
    }
  }

  failProcess(state, message) {
    if (state.done) return;
    state.failure ||= message;
    state.child?.kill();
    if (!state.killTimer) {
      state.killTimer = setTimeout(() => { state.child?.kill("SIGKILL"); }, 2000);
      state.killTimer.unref();
    }
  }

  finish(state, exitCode) {
    if (state.done) return;
    state.done = true;
    clearTimeout(state.timer);
    clearTimeout(state.killTimer);
    const turn = state.turn;
    if (state.failure) turn.error = { message: state.failure };
    else if (!state.init || !state.result || state.result.status !== "SUCCESS" || exitCode !== 0) {
      turn.error = { message: "Antigravity did not produce a verified SUCCESS result with a clean exit. Check local CLI authentication, model availability and quota; no retry was sent." };
    } else if (turn.permissionDenied || turn.toolError) {
      const details = (turn.toolFailures || []).map(item => `${item.name}${item.requiredPermission ? ` (requires ${item.requiredPermission})` : ""}`).join(", ");
      turn.error = { message: `Antigravity reported denied permissions or a tool failure${details ? `: ${details}` : ""}. The delegated work needs parent review.` };
    } else if (!turn.text.trim()) turn.error = { message: "Antigravity returned an empty response; completion is unverified." };
    turn.status = turn.error ? (["CANCELED", "INTERRUPTED"].includes(turn.cliStatus) ? "interrupted" : "failed") : "completed";
    turn.completedAt = new Date().toISOString();
    state.thread.status = "idle";
    state.thread.updatedAt = turn.completedAt;
    this.save("turns", turn);
    this.save("threads", state.thread);
    this.running.delete(turn.threadId);
    this.broadcast("item/completed", { threadId: turn.threadId, turnId: turn.id, item: { type: "agentMessage", text: turn.text } });
    this.broadcast("turn/completed", { threadId: turn.threadId, turn: this.wire(turn) });
  }

  async listen() {
    checkSubscriptionSettings(this.config);
    this.token = fs.readFileSync(this.config.authTokenFile, "utf8").trim();
    if (Buffer.byteLength(this.token) < 24) throw new Error("Peer authentication token must contain at least 24 bytes.");
    if (process.platform !== "win32" && (fs.statSync(this.config.authTokenFile).mode & 0o077)) throw new Error("Peer token permissions must be 0600.");
    for (const dir of [this.config.stateDir, path.join(this.config.stateDir, "threads"), path.join(this.config.stateDir, "turns"), this.config.defaultCwd]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.lockPath = path.join(this.config.stateDir, "server.lock");
    if (fs.existsSync(this.lockPath)) {
      const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8"));
      if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error("Invalid Gemini Peer ownership lock; inspect manually.");
      try { process.kill(lock.pid, 0); throw new Error("Gemini Peer state is already owned by a live process."); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
      fs.unlinkSync(this.lockPath);
    }
    fs.writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
    this.ownsLock = true;
    try {
      for (const turn of this.list("turns")) if (turn.status === "inProgress") {
        if (Number.isInteger(turn.runnerPid) && turn.runnerPid > 0) {
          try { process.kill(turn.runnerPid, 0); throw new Error("An orphaned Gemini runner may still be alive; inspect it before restarting the receiver."); }
          catch (error) { if (error.code !== "ESRCH") throw error; }
        }
        turn.status = "interrupted";
        turn.completedAt = new Date().toISOString();
        turn.error = { message: "Receiver restarted during this turn. Execution outcome is uncertain; inspect work before sending another task." };
        this.save("turns", turn);
        const thread = this.read("threads", turn.threadId);
        thread.status = "idle";
        this.save("threads", thread);
      }
      this.http = http.createServer(createHistoryHandler(this));
      this.wss = new WebSocketServer({ noServer: true, maxPayload: 600 * 1024 });
      this.http.on("upgrade", (req, socket, head) => {
        const actual = Buffer.from(req.headers.authorization || "");
        const expected = Buffer.from(`Bearer ${this.token}`);
        if (req.headers.origin || req.url !== "/" || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return;
        }
        this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit("connection", ws));
      });
      this.wss.on("connection", ws => {
        this.clients.add(ws);
        ws.on("close", () => this.clients.delete(ws));
        ws.on("error", () => {});
        ws.on("message", data => {
          let request;
          try {
            request = JSON.parse(data.toString());
            if (request.id == null) return;
            const result = this.handleRequest(request.method, request.params);
            ws.send(JSON.stringify({ id: request.id, result }));
          } catch (error) {
            ws.send(JSON.stringify({ id: request?.id ?? null, error: { code: -32000, message: error.code ? "Gemini Peer local state or configuration could not be read." : error.message } }));
          }
        });
      });
      await new Promise((resolve, reject) => { this.http.once("error", reject); this.http.listen(this.config.listen.port, this.config.listen.host, resolve); });
      return this.http.address();
    } catch (error) { await this.close(); throw error; }
  }

  async close() {
    this.closed = true;
    const endings = [...this.running.values()].map(state => new Promise(resolve => {
      if (!state.child || state.done) return resolve();
      state.child.once("close", resolve);
      this.failProcess(state, "Gemini Peer receiver stopped; inspect the work before retrying.");
    }));
    await Promise.all(endings);
    for (const ws of this.clients) ws.terminate();
    if (this.wss) await new Promise(resolve => this.wss.close(resolve));
    if (this.http?.listening) await new Promise(resolve => this.http.close(resolve));
    if (this.ownsLock) { fs.unlinkSync(this.lockPath); this.ownsLock = false; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const configPath = process.argv[2] || process.env.GEMINI_PEER_CONFIG || path.join(os.homedir(), ".gemini-peer", "config.json");
  try {
    const server = new GeminiPeerServer(normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8"))));
    await server.listen();
    process.stderr.write("Gemini Peer receiver ready (account authentication and model availability require a separate check).\n");
    const stop = () => server.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    process.stderr.write("Gemini Peer could not start. Check the local config, token file, ownership lock and account-provider settings.\n");
    process.exitCode = 1;
  }
}
