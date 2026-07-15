import type { RecallResult } from "@infolang/sdk";
import { describe, expect, it } from "vitest";

import {
  constantTimeEqual,
  extractCallerId,
  extractTranscript,
  formatMemoryBlock,
  formatToolResult,
  injectMemory,
  parseToolArgs,
  resolveNamespace,
  TimeoutError,
  toolCallsOf,
  withTimeout,
} from "../src/memory.js";
import type { VapiAssistant, VapiMessage } from "../src/types.js";
import { at } from "./helpers.js";

function recall(...chunks: Array<[string, number | undefined]>): RecallResult {
  return {
    chunks: chunks.map(([text, score], i) => ({ id: String(i), text, score })),
    weak: false,
  };
}

describe("withTimeout", () => {
  it("resolves fast promises", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("rejects with TimeoutError when slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 50));
    await expect(withTimeout(slow, 5)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("passes through rejections", async () => {
    await expect(withTimeout(Promise.reject(new Error("nope")), 1000)).rejects.toThrow("nope");
  });

  it("disables the timeout for non-positive ms", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 0)).resolves.toBe("ok");
  });
});

describe("constantTimeEqual", () => {
  it("matches equal strings", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
  });

  it("rejects different strings, lengths, and undefined", () => {
    expect(constantTimeEqual("secret", "secreT")).toBe(false);
    expect(constantTimeEqual("secret", "secret2")).toBe(false);
    expect(constantTimeEqual(undefined, "secret")).toBe(false);
    expect(constantTimeEqual("secret", undefined)).toBe(false);
  });
});

describe("extractCallerId", () => {
  it("prefers message.customer.number", () => {
    const msg: VapiMessage = {
      type: "assistant-request",
      customer: { number: "+15551234567" },
      call: { customer: { number: "+19999999999" } },
    };
    expect(extractCallerId(msg)).toBe("+15551234567");
  });

  it("falls back to call.customer then call.from then call.id", () => {
    expect(extractCallerId({ type: "x", call: { customer: { number: "+1222" } } })).toBe("+1222");
    expect(extractCallerId({ type: "x", call: { from: { number: "+1333" } } })).toBe("+1333");
    expect(extractCallerId({ type: "x", call: { from: { phoneNumber: "+1444" } } })).toBe("+1444");
    expect(extractCallerId({ type: "x", call: { id: "call-9" } })).toBe("call-9");
  });

  it("returns undefined when nothing is present", () => {
    expect(extractCallerId({ type: "x" })).toBeUndefined();
  });
});

describe("resolveNamespace", () => {
  const msg: VapiMessage = { type: "x", customer: { number: "+15551234567" } };

  it("uses namespaceFor first", () => {
    expect(resolveNamespace(msg, { client: {} as never, namespaceFor: () => "dyn" })).toBe("dyn");
  });

  it("uses fixed namespace next", () => {
    expect(resolveNamespace(msg, { client: {} as never, namespace: "fixed" })).toBe("fixed");
  });

  it("derives a per-caller namespace from the caller id", () => {
    expect(resolveNamespace(msg, { client: {} as never })).toBe("voice-caller-15551234567");
  });

  it("honors a custom callerIdFrom and prefix", () => {
    const ns = resolveNamespace(msg, {
      client: {} as never,
      callerIdFrom: () => "user-7",
      namespacePrefix: "vc",
    });
    expect(ns).toBe("vc-user-7");
  });

  it("returns undefined when no caller id is derivable", () => {
    expect(resolveNamespace({ type: "x" }, { client: {} as never })).toBeUndefined();
  });
});

describe("formatMemoryBlock", () => {
  it("numbers non-empty chunks under the prompt", () => {
    const block = formatMemoryBlock(recall(["likes window seats", 0.9], ["", 0.1], ["vegetarian", 0.8]), "Memory:");
    expect(block).toBe("Memory:\n1. likes window seats\n2. vegetarian");
  });

  it("returns null when there is nothing to inject", () => {
    expect(formatMemoryBlock(recall(), "Memory:")).toBeNull();
  });
});

describe("formatToolResult", () => {
  it("serializes chunks and the weak flag", () => {
    const parsed = JSON.parse(formatToolResult(recall(["fact", 0.9])));
    expect(parsed.memories[0]).toEqual({ text: "fact", score: 0.9, tags: undefined });
    expect(parsed.weak).toBe(false);
  });
});

describe("injectMemory", () => {
  it("appends to an existing system message", () => {
    const assistant: VapiAssistant = {
      model: { messages: [{ role: "system", content: "Base prompt." }] },
    };
    injectMemory(assistant, "Memory block");
    expect(at(assistant.model!.messages).content).toBe("Base prompt.\n\nMemory block");
  });

  it("prepends a system message when none exists", () => {
    const assistant: VapiAssistant = { model: { messages: [{ role: "user", content: "hi" }] } };
    injectMemory(assistant, "Memory block");
    expect(at(assistant.model!.messages)).toEqual({ role: "system", content: "Memory block" });
  });

  it("creates model.messages when absent", () => {
    const assistant: VapiAssistant = {};
    injectMemory(assistant, "Memory block");
    expect(at(assistant.model!.messages).content).toBe("Memory block");
  });
});

describe("parseToolArgs", () => {
  it("parses a JSON string", () => {
    expect(parseToolArgs({ id: "1", arguments: '{"query":"x"}' })).toEqual({ query: "x" });
  });

  it("passes through an object", () => {
    expect(parseToolArgs({ id: "1", arguments: { query: "y" } })).toEqual({ query: "y" });
  });

  it("reads function.arguments and parameters", () => {
    expect(parseToolArgs({ id: "1", function: { arguments: { a: 1 } } })).toEqual({ a: 1 });
    expect(parseToolArgs({ id: "1", parameters: { b: 2 } })).toEqual({ b: 2 });
  });

  it("returns {} for bad JSON or missing args", () => {
    expect(parseToolArgs({ id: "1", arguments: "not json" })).toEqual({});
    expect(parseToolArgs({ id: "1" })).toEqual({});
  });

  it("returns {} for a non-string, non-object argument value", () => {
    expect(parseToolArgs({ id: "1", arguments: 42 as unknown as string })).toEqual({});
  });

  it("returns {} for a JSON string that is not an object", () => {
    expect(parseToolArgs({ id: "1", arguments: "42" })).toEqual({});
  });
});

describe("extractTranscript", () => {
  it("prefers summary, then artifact fields, then transcript", () => {
    expect(extractTranscript({ type: "x", summary: "S" })).toBe("S");
    expect(extractTranscript({ type: "x", artifact: { summary: "AS" } })).toBe("AS");
    expect(extractTranscript({ type: "x", transcript: "T" })).toBe("T");
    expect(extractTranscript({ type: "x", artifact: { transcript: "AT" } })).toBe("AT");
    expect(extractTranscript({ type: "x" })).toBeUndefined();
  });
});

describe("toolCallsOf", () => {
  it("reads toolCallList", () => {
    expect(toolCallsOf({ type: "x", toolCallList: [{ id: "1" }] })).toHaveLength(1);
  });

  it("falls back to toolWithToolCallList", () => {
    const calls = toolCallsOf({
      type: "x",
      toolWithToolCallList: [{ toolCall: { id: "9" } }, { name: "no-call" }],
    });
    expect(calls).toEqual([{ id: "9" }]);
  });

  it("returns [] when neither is present", () => {
    expect(toolCallsOf({ type: "x" })).toEqual([]);
  });
});
