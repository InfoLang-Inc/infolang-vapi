import { describe, expect, it, vi } from "vitest";

import { createVapiMemoryHandler } from "../src/handler.js";
import type { VapiAssistant } from "../src/types.js";
import {
  assistantRequest,
  at,
  endOfCallReport,
  FakeInfoLang,
  postRequest,
  toolCallsMessage,
} from "./helpers.js";

function baseAssistant(): VapiAssistant {
  return { model: { messages: [{ role: "system", content: "Base prompt." }] } };
}

// --- assistant-request --------------------------------------------------

describe("assistant-request", () => {
  it("injects recalled caller memory into the assistant system prompt", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["caller is a VIP", 0.95]);
    const handler = createVapiMemoryHandler({ client: fake.asClient(), assistant: baseAssistant() });

    const { status, body } = await handler.dispatch(assistantRequest("+15551234567"));

    expect(status).toBe(200);
    const assistant = (body as { assistant: VapiAssistant }).assistant;
    expect(at(assistant.model!.messages).content).toContain("Base prompt.");
    expect(at(assistant.model!.messages).content).toContain("caller is a VIP");
    expect(at(fake.recallCalls).namespace).toBe("voice-caller-15551234567");
  });

  it("returns the base assistant unchanged when there is no memory", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient(), assistant: baseAssistant() });

    const { body } = await handler.dispatch(assistantRequest("+15551234567"));

    const assistant = (body as { assistant: VapiAssistant }).assistant;
    expect(at(assistant.model!.messages).content).toBe("Base prompt.");
  });

  it("does not mutate the shared assistant option across calls", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["a fact", 0.95]);
    const shared = baseAssistant();
    const handler = createVapiMemoryHandler({ client: fake.asClient(), assistant: shared });

    await handler.dispatch(assistantRequest("+15551234567"));

    expect(at(shared.model!.messages).content).toBe("Base prompt.");
  });

  it("supports an async assistant factory", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({
      client: fake.asClient(),
      assistant: async () => baseAssistant(),
    });

    const { body } = await handler.dispatch(assistantRequest("+15551234567"));
    expect((body as { assistant: VapiAssistant }).assistant).toBeDefined();
  });

  it("returns an empty body when no assistant is configured", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { body } = await handler.dispatch(assistantRequest("+15551234567"));
    expect(body).toEqual({});
  });

  it("fails open when recall times out", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["should not appear", 0.95]);
    fake.recallDelayMs = 50;
    const onError = vi.fn();
    const handler = createVapiMemoryHandler({
      client: fake.asClient(),
      assistant: baseAssistant(),
      recallTimeoutMs: 5,
      onError,
    });

    const { body } = await handler.dispatch(assistantRequest("+15551234567"));

    const assistant = (body as { assistant: VapiAssistant }).assistant;
    expect(at(assistant.model!.messages).content).toBe("Base prompt.");
    expect(onError).toHaveBeenCalledWith(expect.anything(), "recall");
  });

  it("fails open when recall throws", async () => {
    const fake = new FakeInfoLang();
    fake.recallError = new Error("upstream down");
    const handler = createVapiMemoryHandler({ client: fake.asClient(), assistant: baseAssistant() });

    const { body } = await handler.dispatch(assistantRequest("+15551234567"));
    expect((body as { assistant: VapiAssistant }).assistant).toBeDefined();
  });
});

// --- tool-calls ---------------------------------------------------------

describe("tool-calls", () => {
  it("serves a recall tool and a remember tool", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["remembered fact", 0.9]);
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { body } = await handler.dispatch(
      toolCallsMessage("+15551234567", [
        { id: "t1", name: "recall_memory", args: { query: "what do you know" } },
        { id: "t2", name: "remember_memory", args: { text: "caller prefers mornings", tags: "pref" } },
      ]),
    );

    const results = (body as { results: Array<{ toolCallId: string; result: string }> }).results;
    expect(at(results).toolCallId).toBe("t1");
    expect(JSON.parse(at(results).result).memories[0].text).toBe("remembered fact");
    expect(at(results, 1).result).toBe("Saved to memory.");
    expect(fake.rememberCalls[0]).toMatchObject({
      text: "caller prefers mornings",
      namespace: "voice-caller-15551234567",
      source: "vapi",
      tags: "pref",
    });
  });

  it("reports unknown tools without failing the batch", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { body } = await handler.dispatch(
      toolCallsMessage("+15551234567", [{ id: "t1", name: "mystery", args: {} }]),
    );

    const results = (body as { results: Array<{ result: string }> }).results;
    expect(at(results).result).toContain("Unknown tool: mystery");
  });

  it("handles missing query / text arguments", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { body } = await handler.dispatch(
      toolCallsMessage("+15551234567", [
        { id: "t1", name: "recall_memory", args: {} },
        { id: "t2", name: "remember_memory", args: {} },
      ]),
    );

    const results = (body as { results: Array<{ result: string }> }).results;
    expect(at(results).result).toBe("No query provided.");
    expect(at(results, 1).result).toBe("No text provided.");
    expect(fake.recallCalls).toHaveLength(0);
  });

  it("supports custom tool names and disabling a tool", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["x", 0.9]);
    const handler = createVapiMemoryHandler({
      client: fake.asClient(),
      tools: { recall: "lookup", remember: false },
    });

    const { body } = await handler.dispatch(
      toolCallsMessage("+15551234567", [
        { id: "t1", name: "lookup", args: { query: "q", top_k: 2 } },
        { id: "t2", name: "remember_memory", args: { text: "ignored" } },
      ]),
    );

    const results = (body as { results: Array<{ result: string }> }).results;
    expect(JSON.parse(at(results).result).memories).toHaveLength(1);
    expect(at(fake.recallCalls).topK).toBe(2);
    expect(at(results, 1).result).toContain("Unknown tool");
    expect(fake.rememberCalls).toHaveLength(0);
  });

  it("captures per-tool errors as a spoken failure", async () => {
    const fake = new FakeInfoLang();
    fake.rememberError = new Error("write failed");
    const onError = vi.fn();
    const handler = createVapiMemoryHandler({ client: fake.asClient(), onError });

    const { body } = await handler.dispatch(
      toolCallsMessage("+15551234567", [{ id: "t1", name: "remember_memory", args: { text: "x" } }]),
    );

    const results = (body as { results: Array<{ result: string }> }).results;
    expect(at(results).result).toBe("Memory operation failed.");
    expect(onError).toHaveBeenCalledWith(expect.anything(), "tool-calls");
  });

  it("reads the OpenAI-style function.name and labels unnamed tools", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["fact", 0.9]);
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { body } = await handler.dispatch({
      type: "tool-calls",
      call: { id: "call-1", customer: { number: "+15551234567" } },
      toolCallList: [
        { id: "t1", function: { name: "recall_memory", arguments: { query: "q" } } },
        { id: "t2" },
      ],
    });

    const results = (body as { results: Array<{ result: string }> }).results;
    expect(JSON.parse(at(results).result).memories).toHaveLength(1);
    expect(at(results, 1).result).toBe("Unknown tool: (unnamed)");
  });
});

// --- end-of-call-report -------------------------------------------------

describe("end-of-call-report", () => {
  it("remembers the transcript keyed by caller", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { status } = await handler.dispatch(
      endOfCallReport("+15551234567", "AI: hi. User: I want a refund."),
    );

    expect(status).toBe(200);
    expect(fake.rememberCalls[0]).toMatchObject({
      text: "AI: hi. User: I want a refund.",
      namespace: "voice-caller-15551234567",
      tags: "voice,transcript",
    });
  });

  it("no-ops when there is no transcript", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });

    const { status } = await handler.dispatch(endOfCallReport("+15551234567"));
    expect(status).toBe(200);
    expect(fake.rememberCalls).toHaveLength(0);
  });

  it("swallows a remember error", async () => {
    const fake = new FakeInfoLang();
    fake.rememberError = new Error("boom");
    const onError = vi.fn();
    const handler = createVapiMemoryHandler({ client: fake.asClient(), onError });

    const { status } = await handler.dispatch(endOfCallReport("+15551234567", "some transcript"));
    expect(status).toBe(200);
    expect(onError).toHaveBeenCalledWith(expect.anything(), "end-of-call-report");
  });
});

describe("dispatch defaults", () => {
  it("returns 200 for informational events", async () => {
    const fake = new FakeInfoLang();
    const handler = createVapiMemoryHandler({ client: fake.asClient() });
    expect(await handler.dispatch({ type: "status-update" })).toEqual({ status: 200 });
  });
});

// --- secret + handleRequest --------------------------------------------

describe("verifySecret", () => {
  it("passes when no secret is configured", () => {
    const handler = createVapiMemoryHandler({ client: new FakeInfoLang().asClient() });
    expect(handler.verifySecret({})).toBe(true);
  });

  it("checks the X-Vapi-Secret header (Headers and record)", () => {
    const handler = createVapiMemoryHandler({
      client: new FakeInfoLang().asClient(),
      secret: "s3cret",
    });
    expect(handler.verifySecret(new Headers({ "x-vapi-secret": "s3cret" }))).toBe(true);
    expect(handler.verifySecret({ "X-Vapi-Secret": "s3cret" })).toBe(true);
    expect(handler.verifySecret({ "x-vapi-secret": "wrong" })).toBe(false);
    expect(handler.verifySecret({})).toBe(false);
  });
});

describe("handleRequest", () => {
  it("rejects a bad secret with 401", async () => {
    const handler = createVapiMemoryHandler({
      client: new FakeInfoLang().asClient(),
      secret: "s3cret",
    });
    const response = await handler.handleRequest(
      postRequest(assistantRequestBody(), { "x-vapi-secret": "wrong" }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects invalid JSON with 400", async () => {
    const handler = createVapiMemoryHandler({ client: new FakeInfoLang().asClient() });
    const response = await handler.handleRequest(postRequest("{not json", {}));
    expect(response.status).toBe(400);
  });

  it("rejects a body without message.type with 400", async () => {
    const handler = createVapiMemoryHandler({ client: new FakeInfoLang().asClient() });
    const response = await handler.handleRequest(postRequest({ message: {} }));
    expect(response.status).toBe(400);
  });

  it("dispatches a valid request and returns JSON", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["vip caller", 0.95]);
    const handler = createVapiMemoryHandler({ client: fake.asClient(), assistant: baseAssistant() });

    const response = await handler.handleRequest(postRequest(assistantRequestBody()));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { assistant: VapiAssistant };
    expect(at(json.assistant.model!.messages).content).toContain("vip caller");
  });

  it("returns an empty 200 body for events without a response body", async () => {
    const handler = createVapiMemoryHandler({ client: new FakeInfoLang().asClient() });
    const response = await handler.handleRequest(
      postRequest({ message: endOfCallReport("+15551234567") }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("is a 200 safety net when dispatch throws", async () => {
    const onError = vi.fn();
    const handler = createVapiMemoryHandler({
      client: new FakeInfoLang().asClient(),
      assistant: () => {
        throw new Error("factory boom");
      },
      onError,
    });

    const response = await handler.handleRequest(postRequest(assistantRequestBody()));
    expect(response.status).toBe(200);
    expect(onError).toHaveBeenCalledWith(expect.anything(), "dispatch");
  });
});

function assistantRequestBody() {
  return { message: assistantRequest("+15551234567") };
}
