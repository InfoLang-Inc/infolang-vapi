/**
 * Cloudflare Workers entry point.
 *
 * Deploy this as a Worker and point your Vapi Server URL at it. The edge
 * placement keeps `assistant-request` recall well inside Vapi's 7.5s budget.
 *
 * `createFetch` takes injectable dependencies so the handler is testable
 * offline; the default export wires a real `InfoLang` client from Worker env
 * bindings.
 */

import { InfoLang } from "@infolang/sdk";

import { createVapiMemoryHandler } from "./handler.js";
import type { VapiAssistant, VapiMessage } from "./types.js";

/** Worker environment bindings (set as Wrangler vars/secrets). */
export interface Env {
  /** InfoLang managed API key (`il_live_...`). */
  INFOLANG_API_KEY: string;
  /** Optional InfoLang workspace (tenant) to scope to. */
  INFOLANG_WORKSPACE?: string;
  /** Shared secret Vapi sends in `X-Vapi-Secret` (constant-time checked). */
  VAPI_SECRET?: string;
}

/** Minimal Workers `ExecutionContext` (kept local to avoid a types dependency). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Injectable dependencies for {@link createFetch}. */
export interface WorkerDeps {
  createClient: (env: Env) => InfoLang;
  assistant?: VapiAssistant | ((message: VapiMessage) => VapiAssistant | Promise<VapiAssistant>);
  secret?: (env: Env) => string | undefined;
}

/** A minimal example transient assistant; replace with your own. */
export const EXAMPLE_ASSISTANT: VapiAssistant = {
  firstMessage: "Hi, thanks for calling. How can I help?",
  model: {
    provider: "openai",
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful, concise voice assistant. Use any provided caller " +
          "memory to personalize the conversation.",
      },
    ],
  },
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a Worker `fetch` handler with optional injected dependencies. */
export function createFetch(deps: Partial<WorkerDeps> = {}) {
  const createClient =
    deps.createClient ??
    ((env: Env) => new InfoLang({ apiKey: env.INFOLANG_API_KEY, workspace: env.INFOLANG_WORKSPACE }));
  const assistant = deps.assistant ?? EXAMPLE_ASSISTANT;

  return async function fetch(
    request: Request,
    env: Env,
    _ctx?: ExecutionContext,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return jsonError(405, "method not allowed");
    }
    if (!env.INFOLANG_API_KEY) {
      return jsonError(500, "INFOLANG_API_KEY is not configured");
    }
    const handler = createVapiMemoryHandler({
      client: createClient(env),
      secret: deps.secret ? deps.secret(env) : env.VAPI_SECRET,
      assistant,
    });
    return handler.handleRequest(request);
  };
}

export default {
  fetch: createFetch(),
};
