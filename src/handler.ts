/**
 * The Vapi memory handler: recall caller context on `assistant-request`, serve
 * `recall`/`remember` tool calls mid-conversation, and remember the transcript
 * on `end-of-call-report`. Transport-agnostic dispatch plus a `handleRequest`
 * entry for Web `Request`/`Response` runtimes (Cloudflare Workers, etc.).
 */

import { type RecallResult } from "@infolang/sdk";

import {
  extractTranscript,
  formatMemoryBlock,
  formatToolResult,
  injectMemory,
  parseToolArgs,
  resolveNamespace,
  toolCallsOf,
  withTimeout,
} from "./memory.js";
import type {
  VapiAssistant,
  VapiHandlerResult,
  VapiMemoryOptions,
  VapiMessage,
  VapiToolResult,
} from "./types.js";
import {
  DEFAULT_RECALL_TIMEOUT_MS,
  DEFAULT_RECALL_TOOL,
  DEFAULT_REMEMBER_TOOL,
  DEFAULT_SOURCE,
  DEFAULT_START_QUERY,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOP_K,
} from "./version.js";

/** A configured handler, exposing dispatch plus a Web `Request` entry point. */
export interface VapiMemoryHandler {
  /** True if the request carries the expected `X-Vapi-Secret` (or none is set). */
  verifySecret(headers: Headers | Record<string, string | undefined>): boolean;
  /** Dispatch a parsed Vapi message to the right memory operation. */
  dispatch(message: VapiMessage): Promise<VapiHandlerResult>;
  /** Verify, parse, dispatch, and respond for a Web `Request`. */
  handleRequest(request: Request): Promise<Response>;
}

function headerValue(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) return record[key];
  }
  return undefined;
}

function constantTimeEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function toolName(setting: boolean | string | undefined, fallback: string): string | null {
  if (setting === false) return null;
  if (typeof setting === "string") return setting;
  return fallback;
}

function jsonResponse(result: VapiHandlerResult): Response {
  const body = result.body === undefined ? "" : JSON.stringify(result.body);
  return new Response(body, {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a handler bound to an InfoLang client and configuration. */
export function createVapiMemoryHandler(options: VapiMemoryOptions): VapiMemoryHandler {
  const client = options.client;
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const recallQuery = options.recallQuery ?? DEFAULT_START_QUERY;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const timeoutMs = options.recallTimeoutMs ?? DEFAULT_RECALL_TIMEOUT_MS;
  const source = options.source ?? DEFAULT_SOURCE;
  const recallToolName = toolName(options.tools?.recall, DEFAULT_RECALL_TOOL);
  const rememberToolName = toolName(options.tools?.remember, DEFAULT_REMEMBER_TOOL);

  function reportError(error: unknown, context: string): void {
    options.onError?.(error, context);
  }

  async function recallBudgeted(
    query: string,
    namespace: string | undefined,
  ): Promise<RecallResult | null> {
    try {
      return await withTimeout(client.recall(query, { namespace, topK }), timeoutMs);
    } catch (error) {
      reportError(error, "recall");
      return null;
    }
  }

  async function resolveAssistant(message: VapiMessage): Promise<VapiAssistant | undefined> {
    const base = options.assistant;
    if (!base) return undefined;
    const resolved = typeof base === "function" ? await base(message) : base;
    return structuredClone(resolved);
  }

  async function handleAssistantRequest(message: VapiMessage): Promise<VapiHandlerResult> {
    const assistant = await resolveAssistant(message);
    if (!assistant) return { status: 200, body: {} };

    const namespace = resolveNamespace(message, options);
    const result = await recallBudgeted(recallQuery, namespace);
    if (result) {
      const block = formatMemoryBlock(result, systemPrompt);
      if (block) injectMemory(assistant, block);
    }
    return { status: 200, body: { assistant } };
  }

  async function runTool(
    name: string | undefined,
    args: Record<string, unknown>,
    namespace: string | undefined,
  ): Promise<string> {
    if (recallToolName && name === recallToolName) {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return "No query provided.";
      const perCallTopK = typeof args.top_k === "number" ? args.top_k : topK;
      const result = await withTimeout(
        client.recall(query, { namespace, topK: perCallTopK }),
        timeoutMs,
      );
      return formatToolResult(result);
    }
    if (rememberToolName && name === rememberToolName) {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text) return "No text provided.";
      const tags = typeof args.tags === "string" ? args.tags : undefined;
      await client.remember(text, { namespace, source, tags });
      return "Saved to memory.";
    }
    return `Unknown tool: ${name ?? "(unnamed)"}`;
  }

  async function handleToolCalls(message: VapiMessage): Promise<VapiHandlerResult> {
    const namespace = resolveNamespace(message, options);
    const results: VapiToolResult[] = [];
    for (const toolCall of toolCallsOf(message)) {
      const name = toolCall.name ?? toolCall.function?.name;
      let result: string;
      try {
        result = await runTool(name, parseToolArgs(toolCall), namespace);
      } catch (error) {
        reportError(error, "tool-calls");
        result = "Memory operation failed.";
      }
      results.push({ toolCallId: toolCall.id, name, result });
    }
    return { status: 200, body: { results } };
  }

  async function handleEndOfCall(message: VapiMessage): Promise<VapiHandlerResult> {
    const transcript = extractTranscript(message);
    if (!transcript) return { status: 200 };
    const namespace = resolveNamespace(message, options);
    try {
      await client.remember(transcript, { namespace, source, tags: "voice,transcript" });
    } catch (error) {
      reportError(error, "end-of-call-report");
    }
    return { status: 200 };
  }

  async function dispatch(message: VapiMessage): Promise<VapiHandlerResult> {
    switch (message.type) {
      case "assistant-request":
        return handleAssistantRequest(message);
      case "tool-calls":
        return handleToolCalls(message);
      case "end-of-call-report":
        return handleEndOfCall(message);
      default:
        return { status: 200 };
    }
  }

  function verifySecret(headers: Headers | Record<string, string | undefined>): boolean {
    if (!options.secret) return true;
    return constantTimeEqual(headerValue(headers, "x-vapi-secret"), options.secret);
  }

  async function handleRequest(request: Request): Promise<Response> {
    if (!verifySecret(request.headers)) {
      return jsonResponse({ status: 401, body: { error: "unauthorized" } });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ status: 400, body: { error: "invalid JSON body" } });
    }
    const message = (body as { message?: VapiMessage } | null)?.message;
    if (!message || typeof message.type !== "string") {
      return jsonResponse({ status: 400, body: { error: "missing message.type" } });
    }
    try {
      return jsonResponse(await dispatch(message));
    } catch (error) {
      // Safety net: Vapi expects 200 to avoid retry storms; per-handler paths
      // already fail-open, so this only catches truly unexpected errors.
      reportError(error, "dispatch");
      return jsonResponse({ status: 200, body: {} });
    }
  }

  return { verifySecret, dispatch, handleRequest };
}
