#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

export const VERSION = "0.1.0";
export const DEFAULT_MAX_RESPONSE_CHARS = 8000;
export const DEFAULT_PROGRESS_CHECK_AFTER_TURNS = 5;
export const DEFAULT_INITIAL_WAIT_MS = 3000;
export const DEFAULT_RPC_TIMEOUT_MS = 30000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
export const DEFAULT_WAIT_WINDOW_SECONDS = 7200;
export const DEFAULT_POLL_INTERVAL_SECONDS = 15;

const TOOL_DEFINITIONS = [
  {
    name: "peer_health",
    description: "Connect to a peer Codex app-server and run initialize.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string", description: "Peer ID from peers.json, for example windows." }
      },
      required: ["peerId"],
      additionalProperties: false
    }
  },
  {
    name: "peer_message",
    description: "Send a natural-language message to a peer Codex thread.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string" },
        message: { type: "string" },
        threadId: { type: "string" },
        cwd: { type: "string" },
        startNewThread: { type: "boolean" },
        maxResponseChars: { type: "number" },
        waitForCompletion: {
          type: "boolean",
          description: "When true, keep the WebSocket open and return once this turn completes or the quiet wait window ends."
        },
        waitWindowSeconds: {
          type: "number",
          description: "Quiet wait window. Reaching it returns turnCompleted false, not a task failure."
        }
      },
      required: ["peerId", "message"],
      additionalProperties: false
    }
  },
  {
    name: "peer_wait",
    description: "Check a previously-started peer turn without treating long work as failure.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string" },
        threadId: { type: "string" },
        turnId: { type: "string" },
        maxResponseChars: { type: "number" }
      },
      required: ["peerId", "threadId"],
      additionalProperties: false
    }
  },
  {
    name: "peer_wait_until_complete",
    description: "Quietly wait for a previously-started peer turn and return only when it completes or the wait window ends.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string" },
        threadId: { type: "string" },
        turnId: { type: "string" },
        maxResponseChars: { type: "number" },
        waitWindowSeconds: {
          type: "number",
          description: "Quiet wait window. Reaching it returns turnCompleted false, not a task failure."
        },
        pollIntervalSeconds: {
          type: "number",
          description: "Seconds between internal app-server reads while waiting."
        }
      },
      required: ["peerId", "threadId"],
      additionalProperties: false
    }
  },
  {
    name: "peer_threads",
    description: "List peer Codex threads.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string" },
        limit: { type: "number" },
        cwd: { type: "string" }
      },
      required: ["peerId"],
      additionalProperties: false
    }
  },
  {
    name: "peer_read",
    description: "Read a peer Codex thread and summarize its recent turns.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      properties: {
        peerId: { type: "string" },
        threadId: { type: "string" },
        maxItems: { type: "number" },
        maxResponseChars: { type: "number" }
      },
      required: ["peerId", "threadId"],
      additionalProperties: false
    }
  }
];

export function defaultConfigPath(platform = process.platform, env = process.env) {
  if (env.CODEX_PEER_CONFIG) {
    return env.CODEX_PEER_CONFIG;
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, ".codex-peer", "peers.json");
}

export function loadPeerConfig(configPath = defaultConfigPath()) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Codex Peer config not found: ${configPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizePeerConfig(parsed);
}

export function normalizePeerConfig(config) {
  if (!config || typeof config !== "object" || !config.peers || typeof config.peers !== "object") {
    throw new Error("Codex Peer config must include a peers object.");
  }
  return {
    peers: config.peers,
    defaults: {
      maxResponseChars: numberOrDefault(config.defaults?.maxResponseChars, DEFAULT_MAX_RESPONSE_CHARS),
      progressCheckAfterTurns: numberOrDefault(
        config.defaults?.progressCheckAfterTurns,
        DEFAULT_PROGRESS_CHECK_AFTER_TURNS
      ),
      waitWindowSeconds: numberOrDefault(config.defaults?.waitWindowSeconds, DEFAULT_WAIT_WINDOW_SECONDS),
      pollIntervalSeconds: numberOrDefault(config.defaults?.pollIntervalSeconds, DEFAULT_POLL_INTERVAL_SECONDS),
      recordTranscripts: config.defaults?.recordTranscripts === true
    }
  };
}

export function resolvePeer(config, peerId, env = process.env) {
  const peer = config.peers?.[peerId];
  if (!peer || typeof peer !== "object") {
    throw new Error(`Unknown Codex peer: ${peerId}`);
  }
  if (!peer.url || typeof peer.url !== "string") {
    throw new Error(`Codex peer ${peerId} is missing url.`);
  }
  validatePeerConnectionPolicy(peer);
  const token = readPeerToken(peer, env);
  const url = new URL(peer.url);
  if (!isLoopbackHost(url.hostname) && !token) {
    throw new Error("Remote Codex peers require authTokenEnv or authTokenFile.");
  }
  return {
    id: peerId,
    label: peer.label || peerId,
    url: peer.url,
    authToken: token,
    defaultCwd: peer.defaultCwd || null,
    platform: peer.platform || null
  };
}

export function validatePeerConnectionPolicy(peer) {
  const url = new URL(peer.url);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Codex peer URL must use ws:// or wss://: ${url.protocol}`);
  }
  if (url.protocol === "ws:" && !isLoopbackHost(url.hostname)) {
    throw new Error("Refusing non-loopback ws:// peer URL. Use wss:// for remote peers.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Codex peer URLs must not contain credentials, query parameters, or fragments.");
  }
}

export function readPeerToken(peer, env = process.env) {
  if (peer.authTokenEnv) {
    const token = env[peer.authTokenEnv];
    if (token) {
      return token;
    }
    if (!peer.authTokenFile) {
      throw new Error(`Codex peer token env var is not set: ${peer.authTokenEnv}`);
    }
  }

  if (!peer.authTokenFile) {
    return null;
  }

  const tokenPath = resolveTokenFilePath(peer.authTokenFile, env);
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Codex peer token file not found: ${tokenPath}`);
  }
  if (process.platform !== "win32" && (fs.statSync(tokenPath).mode & 0o077) !== 0) {
    throw new Error(`Codex peer token file permissions are too broad: ${tokenPath}. Use chmod 600.`);
  }
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!token) {
    throw new Error(`Codex peer token file is empty: ${tokenPath}`);
  }
  return token;
}

export function resolveTokenFilePath(tokenFile, env = process.env) {
  if (typeof tokenFile !== "string" || !tokenFile) {
    throw new Error("Codex peer authTokenFile must be a non-empty string.");
  }
  if (tokenFile === "~" || tokenFile.startsWith("~/") || tokenFile.startsWith("~\\")) {
    const home = env.HOME || env.USERPROFILE || os.homedir();
    return path.resolve(path.join(home, tokenFile.slice(2)));
  }
  return path.resolve(tokenFile);
}

export class AppServerWsClient {
  constructor(peer, options = {}) {
    this.peer = peer;
    this.WebSocketClass = options.WebSocketClass || WebSocket;
    this.connectTimeoutMs = options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    this.rpcTimeoutMs = options.rpcTimeoutMs || DEFAULT_RPC_TIMEOUT_MS;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.disconnectHandlers = new Set();
    this.ws = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === this.WebSocketClass.OPEN) {
      return;
    }

    const options = this.peer.authToken ? { headers: { Authorization: `Bearer ${this.peer.authToken}` } } : {};
    const ws = new this.WebSocketClass(this.peer.url, undefined, options);
    this.ws = ws;

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
      };
      const onOpen = () => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      };
      const onError = error => {
        clearTimeout(timeout);
        cleanup();
        reject(error);
      };
      const timeout = setTimeout(() => {
        cleanup();
        ws.terminate?.();
        reject(new Error("Timed out connecting to peer Codex app-server."));
      }, this.connectTimeoutMs);
      timeout.unref?.();

      ws.once("open", onOpen);
      ws.once("error", onError);
    });

    ws.on("message", data => this.#handleMessage(data));
    ws.on("close", () => {
      const error = new Error("Peer Codex app-server WebSocket closed.");
      this.#rejectAll(error);
      this.#notifyDisconnected(error);
    });
    ws.on("error", error => {
      this.#rejectAll(error);
      this.#notifyDisconnected(error);
    });
  }

  async initialize() {
    await this.connect();
    return this.request("initialize", {
      clientInfo: {
        name: "codex-peer",
        title: "Codex Peer",
        version: VERSION
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  request(method, params = {}, timeoutMs = this.rpcTimeoutMs) {
    if (!this.ws || this.ws.readyState !== this.WebSocketClass.OPEN) {
      throw new Error("Peer Codex app-server WebSocket is not open.");
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for peer Codex app-server ${method}.`));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }), error => {
        if (error) {
          this.#rejectPending(id, error);
        }
      });
    });
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onDisconnect(handler) {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  close() {
    if (this.ws && this.ws.readyState === this.WebSocketClass.OPEN) {
      this.ws.close();
    }
    this.#rejectAll(new Error("Peer Codex app-server client closed."));
    this.ws = null;
  }

  #handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }

    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Peer Codex app-server returned an error."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && !("id" in message)) {
      for (const handler of this.notificationHandlers) {
        handler(message.method, message.params || {});
      }
    }
  }

  #rejectPending(id, error) {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #notifyDisconnected(error) {
    for (const handler of this.disconnectHandlers) {
      handler(error);
    }
  }
}

export async function callPeerHealth(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  try {
    const initialized = await client.initialize();
    return {
      ok: true,
      peerId: peer.id,
      label: peer.label,
      platformOs: initialized.platformOs || null,
      platformFamily: initialized.platformFamily || null,
      codexHome: initialized.codexHome || null,
      userAgent: initialized.userAgent || null
    };
  } finally {
    client.close();
  }
}

export async function callPeerMessage(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  const maxResponseChars = numberOrDefault(args.maxResponseChars, config.defaults.maxResponseChars);
  const waitMs = args.waitForCompletion
    ? secondsToMs(args.waitWindowSeconds, config.defaults.waitWindowSeconds)
    : numberOrDefault(options.initialWaitMs, DEFAULT_INITIAL_WAIT_MS);
  let recorder = null;
  let unsubscribe = null;
  try {
    await client.initialize();
    const threadId = await ensureThread(client, peer, args);
    if (args.threadId && !args.startNewThread) {
      await client.request("thread/resume", { threadId, excludeTurns: false }).catch(() => null);
    }
    const collector = createTurnCollector(threadId);
    unsubscribe = client.onNotification((method, params) => collector.handle(method, params));

    const response = await client.request("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: args.message,
        text_elements: []
      }]
    });
    collector.turnId = extractTurnId(response) || collector.turnId;
    recorder = new TranscriptRecorder(peer.id, threadId, collector.turnId, {
      enabled: config.defaults.recordTranscripts
    });
    recorder.write("request", { method: "turn/start", threadId, turnId: collector.turnId });
    collector.onEvent = event => recorder.write("notification", event);

    const completed = await waitForCollectorCompletion(client, collector, waitMs);
    const turns = await readTurns(client, threadId, 20).catch(() => []);
    const turn = findTurn(turns, collector.turnId) || collector.completedTurn;
    const finalText = buildFinalText(collector.text, turn, maxResponseChars);
    const turnCount = turns.length || (collector.turnId ? 1 : 0);
    const terminal = completed || isTurnTerminal(turn);
    const succeeded = terminal ? isTurnSuccessful(turn) : null;
    const turnStatus = turn?.status || (terminal ? "unknown" : "inProgress");
    const turnError = extractTurnError(turn);

    recorder.write("result", {
      turnCompleted: terminal,
      turnStatus,
      turnSucceeded: succeeded,
      turnCount,
      responseChars: finalText.length
    });

    return {
      ok: succeeded !== false,
      peerId: peer.id,
      threadId,
      turnId: collector.turnId,
      turnCompleted: terminal,
      turnStatus,
      turnSucceeded: succeeded,
      turnError,
      finalText: terminal ? finalText : undefined,
      latestText: terminal ? undefined : finalText,
      transcriptPath: recorder.path,
      needsUserCheck: needsUserCheckForTurns(turnCount, config.defaults.progressCheckAfterTurns),
      warnings: turnWarnings(terminal, succeeded, turnStatus, "Peer turn is still running. Use peer_wait_until_complete or peer_wait later.")
    };
  } finally {
    unsubscribe?.();
    recorder?.close();
    client.close();
  }
}

export async function callPeerWait(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  const maxResponseChars = numberOrDefault(args.maxResponseChars, config.defaults.maxResponseChars);
  let recorder = null;
  try {
    await client.initialize();
    await client.request("thread/resume", { threadId: args.threadId, excludeTurns: false }).catch(() => null);
    const turns = await readTurns(client, args.threadId, 30);
    const turn = args.turnId ? findTurn(turns, args.turnId) : turns[0] || null;
    const turnId = args.turnId || turn?.id || null;
    recorder = new TranscriptRecorder(peer.id, args.threadId, turnId || "unknown", {
      enabled: config.defaults.recordTranscripts
    });
    const finalText = truncate(extractAssistantTextFromTurn(turn), maxResponseChars);
    const completed = isTurnTerminal(turn);
    const succeeded = completed ? isTurnSuccessful(turn) : null;
    const turnStatus = turn?.status || (completed ? "unknown" : "inProgress");
    const turnError = extractTurnError(turn);

    recorder.write("read", {
      threadId: args.threadId,
      turnId,
      turnCompleted: completed,
      turnStatus,
      turnSucceeded: succeeded,
      responseChars: finalText.length
    });

    return {
      ok: succeeded !== false,
      peerId: peer.id,
      threadId: args.threadId,
      turnId,
      turnCompleted: completed,
      turnStatus,
      turnSucceeded: succeeded,
      turnError,
      finalText: completed ? finalText : undefined,
      latestText: completed ? undefined : finalText,
      transcriptPath: recorder.path,
      needsUserCheck: needsUserCheckForTurns(turns.length, config.defaults.progressCheckAfterTurns),
      warnings: turnWarnings(completed, succeeded, turnStatus, "Peer turn has not completed yet.")
    };
  } finally {
    recorder?.close();
    client.close();
  }
}

export async function callPeerWaitUntilComplete(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  const maxResponseChars = numberOrDefault(args.maxResponseChars, config.defaults.maxResponseChars);
  const waitWindowMs = secondsToMs(args.waitWindowSeconds, config.defaults.waitWindowSeconds);
  const pollIntervalMs = secondsToMs(args.pollIntervalSeconds, config.defaults.pollIntervalSeconds);
  const startedAt = Date.now();
  const deadline = startedAt + waitWindowMs;
  let recorder = null;
  let turns = [];
  let turn = null;
  let turnId = args.turnId || null;
  try {
    await client.initialize();
    recorder = new TranscriptRecorder(peer.id, args.threadId, turnId || "latest", {
      enabled: config.defaults.recordTranscripts
    });
    recorder.write("wait/start", {
      threadId: args.threadId,
      turnId,
      waitWindowSeconds: Math.round(waitWindowMs / 1000),
      pollIntervalSeconds: Math.round(pollIntervalMs / 1000)
    });

    while (true) {
      await client.request("thread/resume", { threadId: args.threadId, excludeTurns: false }).catch(() => null);
      turns = await readTurns(client, args.threadId, 30);
      turn = turnId ? findTurn(turns, turnId) : turns[0] || null;
      turnId = turnId || turn?.id || null;

      if (isTurnTerminal(turn) || Date.now() >= deadline) {
        break;
      }

      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }

    const finalText = truncate(extractAssistantTextFromTurn(turn), maxResponseChars);
    const completed = isTurnTerminal(turn);
    const succeeded = completed ? isTurnSuccessful(turn) : null;
    const turnStatus = turn?.status || (completed ? "unknown" : "inProgress");
    const turnError = extractTurnError(turn);
    const waitedMs = Date.now() - startedAt;

    recorder.write("wait/result", {
      threadId: args.threadId,
      turnId,
      turnCompleted: completed,
      turnStatus,
      turnSucceeded: succeeded,
      waitedMs,
      responseChars: finalText.length
    });

    return {
      ok: succeeded !== false,
      peerId: peer.id,
      threadId: args.threadId,
      turnId,
      turnCompleted: completed,
      turnStatus,
      turnSucceeded: succeeded,
      turnError,
      finalText: completed ? finalText : undefined,
      latestText: completed ? undefined : finalText,
      waitedMs,
      transcriptPath: recorder.path,
      needsUserCheck: needsUserCheckForTurns(turns.length, config.defaults.progressCheckAfterTurns),
      warnings: turnWarnings(completed, succeeded, turnStatus, "Peer turn is still running after the quiet wait window.")
    };
  } finally {
    recorder?.close();
    client.close();
  }
}

export async function callPeerThreads(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  try {
    await client.initialize();
    const response = await client.request("thread/list", {
      limit: numberOrDefault(args.limit, 20),
      cwd: args.cwd || undefined,
      sortDirection: "desc"
    });
    return {
      ok: true,
      peerId: peer.id,
      threads: (response.data || []).map(summarizeThread),
      nextCursor: response.nextCursor || null
    };
  } finally {
    client.close();
  }
}

export async function callPeerRead(config, args, options = {}) {
  const peer = resolvePeer(config, args.peerId, options.env);
  const client = new AppServerWsClient(peer, options);
  const maxItems = numberOrDefault(args.maxItems, 20);
  const maxResponseChars = numberOrDefault(args.maxResponseChars, config.defaults.maxResponseChars);
  try {
    await client.initialize();
    const turns = await readTurns(client, args.threadId, maxItems);
    const latestTurn = turns[0] || null;
    return {
      ok: true,
      peerId: peer.id,
      threadId: args.threadId,
      turnCompleted: latestTurn ? isTurnTerminal(latestTurn) : null,
      turnStatus: latestTurn?.status || null,
      turnSucceeded: latestTurn && isTurnTerminal(latestTurn) ? isTurnSuccessful(latestTurn) : null,
      turnError: extractTurnError(latestTurn),
      finalText: latestTurn ? truncate(extractAssistantTextFromTurn(latestTurn), maxResponseChars) : "",
      turns: turns.map(turn => summarizeTurn(turn, maxResponseChars)),
      needsUserCheck: needsUserCheckForTurns(turns.length, config.defaults.progressCheckAfterTurns)
    };
  } finally {
    client.close();
  }
}

export function createMcpServer(options = {}) {
  const server = new Server(
    {
      name: "codex-peer",
      version: VERSION
    },
    {
      capabilities: {
        tools: {}
      },
      instructions:
        "Use Codex Peer for remote Codex collaboration. Do not require peerStatus labels; read peer natural-language reports and decide the next action. Long turns are normal; use peer_message with waitForCompletion or peer_wait_until_complete for quiet monitoring, and avoid repeating unchanged in-progress updates to the user."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;
    try {
      const config = options.config || loadPeerConfig(options.configPath);
      const result = await callToolByName(config, name, args, options);
      return jsonToolResult(result, result?.ok === false);
    } catch (error) {
      return jsonToolResult({ ok: false, error: safeErrorMessage(error) }, true);
    }
  });

  return server;
}

export async function callToolByName(config, name, args, options = {}) {
  if (name === "peer_health") return callPeerHealth(config, args, options);
  if (name === "peer_message") return callPeerMessage(config, args, options);
  if (name === "peer_wait") return callPeerWait(config, args, options);
  if (name === "peer_wait_until_complete") return callPeerWaitUntilComplete(config, args, options);
  if (name === "peer_threads") return callPeerThreads(config, args, options);
  if (name === "peer_read") return callPeerRead(config, args, options);
  throw new Error(`Unknown tool: ${name}`);
}

export function jsonToolResult(value, isError = false) {
  return {
    isError,
    content: [{
      type: "text",
      text: JSON.stringify(value, null, 2)
    }]
  };
}

async function ensureThread(client, peer, args) {
  if (!args.startNewThread && args.threadId) {
    return args.threadId;
  }
  const started = await client.request("thread/start", {
    cwd: args.cwd || peer.defaultCwd || undefined,
    serviceName: "codex-peer"
  });
  const threadId = extractThreadId(started);
  if (!threadId) {
    throw new Error("Peer Codex did not return a thread ID.");
  }
  return threadId;
}

export async function readTurns(client, threadId, limit = 20) {
  const response = await client.request("thread/turns/list", {
    threadId,
    limit,
    sortDirection: "desc"
  }).catch(async () => {
    const fallback = await client.request("thread/read", {
      threadId,
      includeTurns: true
    });
    return { data: fallback?.thread?.turns || [] };
  });
  return response.data || [];
}

export function createTurnCollector(threadId) {
  const collector = {
    threadId,
    turnId: null,
    text: "",
    completed: false,
    completedTurn: null,
    onEvent: null,
    waiters: [],
    handle(method, params = {}) {
      if (params.threadId !== threadId) {
        return;
      }
      const event = sanitizeTranscriptEvent(method, params);
      this.onEvent?.(event);

      if (method === "turn/started") {
        this.turnId = params.turn?.id || this.turnId;
        return;
      }
      if (method === "item/agentMessage/delta") {
        if (this.turnId && params.turnId && params.turnId !== this.turnId) {
          return;
        }
        if (typeof params.delta === "string") {
          this.text = appendDelta(this.text, params.delta);
        }
        return;
      }
      if (method === "item/completed" && params.item?.type === "agentMessage") {
        if (this.turnId && params.turnId && params.turnId !== this.turnId) {
          return;
        }
        if (typeof params.item.text === "string" && !this.text.includes(params.item.text)) {
          this.text = appendDelta(this.text, params.item.text);
        }
        return;
      }
      if (method === "turn/completed") {
        if (this.turnId && params.turn?.id && params.turn.id !== this.turnId) {
          return;
        }
        this.turnId = params.turn?.id || this.turnId;
        this.completed = true;
        this.completedTurn = params.turn || null;
        for (const resolve of this.waiters.splice(0)) {
          resolve(true);
        }
      }
    },
    waitForCompletion(waitMs) {
      if (this.completed) {
        return Promise.resolve(true);
      }
      return new Promise(resolve => {
        const timeout = setTimeout(() => {
          const index = this.waiters.indexOf(resolve);
          if (index >= 0) this.waiters.splice(index, 1);
          resolve(false);
        }, waitMs);
        timeout.unref?.();
        this.waiters.push(value => {
          clearTimeout(timeout);
          resolve(value);
        });
      });
    }
  };
  return collector;
}

export class TranscriptRecorder {
  constructor(peerId, threadId, turnId, options = {}) {
    this.enabled = options.enabled === true;
    this.path = null;
    this.fd = null;
    if (!this.enabled) {
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const baseDir = options.rootDir || process.env.CODEX_PEER_RUN_DIR || path.join(os.homedir(), ".codex-peer", "runs", date);
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(baseDir, 0o700);
    }
    this.path = path.join(baseDir, `${safeSegment(peerId)}-${safeSegment(threadId)}-${safeSegment(turnId || "pending")}.jsonl`);
    this.fd = fs.openSync(this.path, "a", 0o600);
    if (process.platform !== "win32") {
      fs.chmodSync(this.path, 0o600);
    }
  }

  write(type, payload) {
    if (this.fd === null) {
      return;
    }
    fs.writeSync(this.fd, JSON.stringify({
      at: new Date().toISOString(),
      type,
      payload
    }) + "\n", null, "utf8");
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export function appendDelta(current, delta) {
  if (!current || /\s$/.test(current) || /^\s/.test(delta)) {
    return current + delta;
  }
  return `${current}${delta}`;
}

export function needsUserCheckForTurns(turnCount, threshold = DEFAULT_PROGRESS_CHECK_AFTER_TURNS) {
  return Number.isFinite(turnCount) && Number.isFinite(threshold) && threshold > 0 && turnCount >= threshold;
}

export function extractAssistantTextFromTurn(turn) {
  if (!turn?.items || !Array.isArray(turn.items)) {
    return "";
  }
  return turn.items
    .filter(item => item?.type === "agentMessage" && typeof item.text === "string")
    .map(item => item.text)
    .join("\n\n")
    .trim();
}

export function buildFinalText(streamedText, turn, maxChars) {
  const fromTurn = extractAssistantTextFromTurn(turn);
  return truncate((fromTurn || streamedText || "").trim(), maxChars);
}

export function findTurn(turns, turnId) {
  if (!turnId) {
    return turns?.[0] || null;
  }
  return (turns || []).find(turn => turn.id === turnId) || null;
}

export function isTurnCompleted(turn) {
  return isTurnTerminal(turn);
}

export function isTurnTerminal(turn) {
  return Boolean(turn && (["completed", "failed", "interrupted"].includes(turn.status) || turn.completedAt));
}

export function isTurnSuccessful(turn) {
  return Boolean(turn && (turn.status === "completed" || (!turn.status && turn.completedAt)));
}

export function extractThreadId(value) {
  return value?.thread?.id || value?.threadId || value?.id || null;
}

export function extractTurnId(value) {
  return value?.turn?.id || value?.turnId || value?.id || null;
}

export function summarizeThread(thread) {
  return {
    id: thread.id,
    name: thread.name || null,
    preview: thread.preview || "",
    cwd: thread.cwd || null,
    status: thread.status || null,
    createdAt: thread.createdAt || null,
    updatedAt: thread.updatedAt || null
  };
}

export function summarizeTurn(turn, maxResponseChars = DEFAULT_MAX_RESPONSE_CHARS) {
  return {
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    durationMs: turn.durationMs || null,
    assistantText: truncate(extractAssistantTextFromTurn(turn), maxResponseChars)
  };
}

export function truncate(value, maxChars = DEFAULT_MAX_RESPONSE_CHARS) {
  const text = String(value || "");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function secondsToMs(value, fallbackSeconds) {
  return Math.round(numberOrDefault(value, fallbackSeconds) * 1000);
}

function sleep(ms) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

function waitForCollectorCompletion(client, collector, waitMs) {
  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    const cleanup = () => unsubscribe?.();
    unsubscribe = client.onDisconnect(error => {
      cleanup();
      reject(error);
    });
    collector.waitForCompletion(waitMs).then(
      value => {
        cleanup();
        resolve(value);
      },
      error => {
        cleanup();
        reject(error);
      }
    );
  });
}

function isLoopbackHost(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function sanitizeTranscriptEvent(method, params = {}) {
  return {
    method,
    params: {
      threadId: params.threadId || null,
      turnId: params.turnId || params.turn?.id || null,
      turnStatus: params.turn?.status || null,
      itemId: params.itemId || params.item?.id || null,
      itemType: params.item?.type || null,
      deltaChars: typeof params.delta === "string" ? params.delta.length : null
    }
  };
}

function extractTurnError(turn) {
  const error = turn?.error;
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return safeErrorMessage(error);
  }
  if (typeof error.message === "string") {
    return safeErrorMessage(error.message);
  }
  return error.code ? `Peer turn error: ${String(error.code)}` : "Peer turn failed.";
}

function turnWarnings(terminal, succeeded, status, runningMessage) {
  if (!terminal) {
    return [runningMessage];
  }
  if (succeeded === false) {
    return [`Peer turn ended with status ${status || "unknown"}.`];
  }
  return [];
}

function safeSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120);
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:token|api[_ -]?key|secret|password)\s*[:=]\s*)\S+/gi, "$1[redacted]");
}

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
