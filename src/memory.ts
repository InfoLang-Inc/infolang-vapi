/**
 * Pure helpers shared by the handler: secret comparison, latency budgeting,
 * caller-id extraction, namespace resolution, memory formatting, and tool-arg
 * parsing. Kept side-effect free so they are trivially unit testable.
 */

import type { RecallResult } from "@infolang/sdk";

import { voiceNamespace } from "./namespaces.js";
import type {
  VapiAssistant,
  VapiMemoryOptions,
  VapiMessage,
  VapiToolCall,
} from "./types.js";

/** Raised by {@link withTimeout} when a promise exceeds its budget. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Resolve `promise`, or reject with {@link TimeoutError} after `ms`. A
 * non-positive `ms` disables the timeout. The timer is always cleared.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Length-checked constant-time string comparison. Returns `false` for non-string
 * or length-mismatched inputs; otherwise compares every character.
 */
export function constantTimeEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Extract the caller's identity from a Vapi message (customer, then fallbacks). */
export function extractCallerId(message: VapiMessage): string | undefined {
  const call = message.call;
  return firstString(
    message.customer?.number,
    message.customer?.phoneNumber,
    message.customer?.sipUri,
    call?.customer?.number,
    call?.customer?.phoneNumber,
    call?.customer?.sipUri,
    call?.from?.number,
    call?.from?.phoneNumber,
    call?.id,
  );
}

/**
 * Resolve the namespace (bank) for a message: explicit `namespaceFor`, then a
 * fixed `namespace`, then a per-caller namespace derived from the caller id.
 * Returns `undefined` to fall back to the client's default namespace.
 */
export function resolveNamespace(
  message: VapiMessage,
  options: VapiMemoryOptions,
): string | undefined {
  const dynamic = options.namespaceFor?.(message);
  if (dynamic) return dynamic;
  if (options.namespace) return options.namespace;
  const callerId = (options.callerIdFrom ?? extractCallerId)(message);
  if (callerId) return voiceNamespace(callerId, options.namespacePrefix);
  return undefined;
}

/** Format recalled chunks into a system-message block, or `null` if empty. */
export function formatMemoryBlock(result: RecallResult, systemPrompt: string): string | null {
  const lines = result.chunks
    .filter((chunk) => chunk.text)
    .map((chunk, index) => `${index + 1}. ${chunk.text}`);
  if (lines.length === 0) return null;
  return `${systemPrompt.replace(/\n+$/, "")}\n${lines.join("\n")}`;
}

/** Serialize a recall result into the string a Vapi tool result expects. */
export function formatToolResult(result: RecallResult): string {
  return JSON.stringify({
    memories: result.chunks.map((chunk) => ({
      text: chunk.text,
      score: chunk.score,
      tags: chunk.tags,
    })),
    weak: result.weak,
  });
}

/** Inject a system message carrying recalled memory into an assistant config. */
export function injectMemory(assistant: VapiAssistant, block: string): void {
  const model = (assistant.model ??= {});
  const messages = (model.messages ??= []);
  const existing = messages.find((message) => message.role === "system");
  if (existing) {
    existing.content = `${existing.content}\n\n${block}`.trim();
  } else {
    messages.unshift({ role: "system", content: block });
  }
}

/** Normalize a tool call's arguments (JSON string or object) into a record. */
export function parseToolArgs(toolCall: VapiToolCall): Record<string, unknown> {
  const raw = toolCall.arguments ?? toolCall.function?.arguments ?? toolCall.parameters;
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/** Best-effort extraction of an end-of-call transcript/summary to remember. */
export function extractTranscript(message: VapiMessage): string | undefined {
  return firstString(
    message.summary,
    message.artifact?.summary,
    message.transcript,
    message.artifact?.transcript,
  );
}

/** The tool call list, tolerating either documented shape. */
export function toolCallsOf(message: VapiMessage): VapiToolCall[] {
  if (Array.isArray(message.toolCallList) && message.toolCallList.length > 0) {
    return message.toolCallList;
  }
  const wrapped = message.toolWithToolCallList
    ?.map((entry) => entry.toolCall)
    .filter((call): call is VapiToolCall => Boolean(call));
  return wrapped ?? [];
}
