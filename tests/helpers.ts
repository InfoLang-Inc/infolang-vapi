/** Offline test doubles: a fake InfoLang client and Vapi message builders. */

import type { InfoLang, RecallResult } from "@infolang/sdk";

import type { VapiMessage } from "../src/types.js";

export interface RememberCall {
  text: string;
  namespace?: string;
  source?: string;
  tags?: string;
}

export interface RecallCall {
  query: string;
  namespace?: string;
  topK?: number;
}

export class FakeInfoLang {
  recallResult: RecallResult = { chunks: [], weak: true };
  recallError: Error | null = null;
  recallDelayMs = 0;
  rememberError: Error | null = null;
  recallCalls: RecallCall[] = [];
  rememberCalls: RememberCall[] = [];

  setChunks(...chunks: Array<[string, number | undefined]>): void {
    this.recallResult = {
      chunks: chunks.map(([text, score], i) => ({ id: String(i), text, score })),
      weak: chunks.length === 0 || (chunks[0]?.[1] ?? 0) < 0.85,
    };
  }

  async recall(
    query: string,
    options: { namespace?: string; topK?: number } = {},
  ): Promise<RecallResult> {
    this.recallCalls.push({ query, namespace: options.namespace, topK: options.topK });
    if (this.recallDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.recallDelayMs));
    }
    if (this.recallError) throw this.recallError;
    return this.recallResult;
  }

  async remember(
    text: string,
    options: { namespace?: string; source?: string; tags?: string } = {},
  ): Promise<{ memoryId: string }> {
    this.rememberCalls.push({
      text,
      namespace: options.namespace,
      source: options.source,
      tags: options.tags,
    });
    if (this.rememberError) throw this.rememberError;
    return { memoryId: "mem-fake" };
  }

  /** Cast to the SDK type for handler options. */
  asClient(): InfoLang {
    return this as unknown as InfoLang;
  }
}

export function assistantRequest(callerNumber?: string): VapiMessage {
  return {
    type: "assistant-request",
    customer: callerNumber ? { number: callerNumber } : undefined,
    call: { id: "call-1" },
  };
}

export function toolCallsMessage(
  callerNumber: string,
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> | string }>,
): VapiMessage {
  return {
    type: "tool-calls",
    call: { id: "call-1", customer: { number: callerNumber } },
    toolCallList: toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.args })),
  };
}

export function endOfCallReport(callerNumber: string, transcript?: string, summary?: string): VapiMessage {
  return {
    type: "end-of-call-report",
    endedReason: "hangup",
    call: { id: "call-1", customer: { number: callerNumber } },
    artifact: { transcript, summary },
  };
}

/** Index into an array, asserting the element exists (for strict tests). */
export function at<T>(arr: readonly T[] | undefined, index = 0): T {
  const value = arr?.[index];
  if (value === undefined) throw new Error(`index ${index} out of range`);
  return value;
}

export function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://worker.example/vapi", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
