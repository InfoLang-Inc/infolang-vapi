/**
 * Vapi server-webhook payload types (subset used by this integration) plus the
 * handler's option and result types.
 *
 * Shapes mirror Vapi's documented Server URL messages
 * (https://docs.vapi.ai/server-url/events): every request is
 * `{ message: { type, call, ... } }`. Only the fields this integration reads are
 * modeled; everything else is left open.
 */

import type { InfoLang } from "@infolang/sdk";

/** A phone endpoint on the call (caller = `customer`). */
export interface VapiPhoneEndpoint {
  number?: string;
  phoneNumber?: string;
  sipUri?: string;
}

/** The Vapi Call object (only fields we read). */
export interface VapiCall {
  id?: string;
  customer?: VapiPhoneEndpoint;
  from?: VapiPhoneEndpoint;
  [key: string]: unknown;
}

/** A single tool call inside a `tool-calls` message. */
export interface VapiToolCall {
  id: string;
  name?: string;
  arguments?: Record<string, unknown> | string;
  parameters?: Record<string, unknown>;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

export interface VapiToolWithToolCall {
  name?: string;
  toolCall?: VapiToolCall;
}

/** Transcript artifact on `end-of-call-report`. */
export interface VapiArtifact {
  transcript?: string;
  summary?: string;
  messages?: Array<{ role?: string; message?: string; content?: string }>;
}

/** The `message` envelope common to all server events. */
export interface VapiMessage {
  type: string;
  call?: VapiCall;
  customer?: VapiPhoneEndpoint;
  phoneNumber?: VapiPhoneEndpoint | string;
  toolCallList?: VapiToolCall[];
  toolWithToolCallList?: VapiToolWithToolCall[];
  artifact?: VapiArtifact;
  transcript?: string;
  summary?: string;
  endedReason?: string;
  [key: string]: unknown;
}

/** The full webhook request body. */
export interface VapiWebhookBody {
  message: VapiMessage;
}

/** A Vapi assistant configuration (open shape; we only touch `model.messages`). */
export interface VapiAssistant {
  model?: {
    provider?: string;
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Result of a single tool call, returned to Vapi. */
export interface VapiToolResult {
  toolCallId: string;
  name?: string;
  result: string;
}

/** What the handler produces: an HTTP status plus an optional JSON body. */
export interface VapiHandlerResult {
  status: number;
  body?: unknown;
}

/** Options for {@link createVapiMemoryHandler}. */
export interface VapiMemoryOptions {
  /** InfoLang client (workspace = tenant). Provide one built for your runtime. */
  client: InfoLang;
  /**
   * Shared secret expected in the `X-Vapi-Secret` header. When set, requests
   * with a missing/incorrect secret are rejected (401) via a constant-time
   * compare. When unset, no secret check is performed (use only in dev).
   */
  secret?: string;
  /** Fixed namespace (bank) for all callers. Overridden by {@link namespaceFor}. */
  namespace?: string;
  /** Dynamic per-message namespace. Return `undefined` to fall back. */
  namespaceFor?: (message: VapiMessage) => string | undefined;
  /** Override how the caller id is extracted from a message. */
  callerIdFrom?: (message: VapiMessage) => string | undefined;
  /** Prefix used when deriving a namespace from the caller id. */
  namespacePrefix?: string;
  /**
   * Base transient assistant returned for `assistant-request`, into which
   * recalled caller context is injected. Static object or a (sync/async)
   * factory. If omitted, `assistant-request` returns an empty body.
   */
  assistant?:
    | VapiAssistant
    | ((message: VapiMessage) => VapiAssistant | Promise<VapiAssistant>);
  /** Prefix line for the injected memory system message. */
  systemPrompt?: string;
  /**
   * Query used to recall caller context at call start (`assistant-request`),
   * where no user utterance exists yet. Defaults to a broad caller-context query.
   */
  recallQuery?: string;
  /** Max memories recalled per call/tool invocation. */
  topK?: number;
  /** Recall latency budget in ms (fail-open on timeout). */
  recallTimeoutMs?: number;
  /** Provenance tag written on stored memories. */
  source?: string;
  /** Enable/disable and rename the recall + remember tools. */
  tools?: {
    recall?: boolean | string;
    remember?: boolean | string;
  };
  /** Optional error hook (never throws into the response path). */
  onError?: (error: unknown, context: string) => void;
}
