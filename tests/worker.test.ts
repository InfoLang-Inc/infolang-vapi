import { describe, expect, it, vi } from "vitest";

import type { VapiAssistant } from "../src/types.js";
import { createFetch, type Env } from "../src/worker.js";
import { assistantRequest, at, endOfCallReport, FakeInfoLang, postRequest } from "./helpers.js";

const ENV: Env = { INFOLANG_API_KEY: "il_test_key" };

describe("createFetch", () => {
  it("wires a client and dispatches a POST", async () => {
    const fake = new FakeInfoLang();
    fake.setChunks(["known caller", 0.95]);
    const fetch = createFetch({
      createClient: () => fake.asClient(),
      assistant: { model: { messages: [{ role: "system", content: "Base." }] } },
    });

    const response = await fetch(postRequest({ message: assistantRequest("+15551234567") }), ENV);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { assistant: VapiAssistant };
    expect(at(json.assistant.model!.messages).content).toContain("known caller");
  });

  it("rejects non-POST methods with 405", async () => {
    const fetch = createFetch({ createClient: () => new FakeInfoLang().asClient() });
    const response = await fetch(new Request("https://worker.example/vapi"), ENV);
    expect(response.status).toBe(405);
  });

  it("returns 500 when the API key is not configured", async () => {
    const fetch = createFetch({ createClient: () => new FakeInfoLang().asClient() });
    const response = await fetch(postRequest({ message: assistantRequest("+1555") }), {
      INFOLANG_API_KEY: "",
    });
    expect(response.status).toBe(500);
  });

  it("passes the env secret to the handler", async () => {
    const secretFn = vi.fn((env: Env) => env.VAPI_SECRET);
    const fetch = createFetch({ createClient: () => new FakeInfoLang().asClient(), secret: secretFn });
    const response = await fetch(postRequest({ message: assistantRequest("+1555") }), {
      INFOLANG_API_KEY: "k",
      VAPI_SECRET: "top-secret",
    });
    // No X-Vapi-Secret header -> 401 because a secret is configured.
    expect(response.status).toBe(401);
    expect(secretFn).toHaveBeenCalled();
  });

  it("builds a default client without throwing at construction", () => {
    // Exercises the default createClient branch (no network until a call).
    expect(() => createFetch()).not.toThrow();
  });

  it("constructs the real default client for a no-op event (no network)", async () => {
    // end-of-call-report without a transcript short-circuits before any
    // network call, so the default `new InfoLang(...)` path is exercised safely.
    const fetch = createFetch();
    const response = await fetch(postRequest({ message: endOfCallReport("+15551234567") }), ENV);
    expect(response.status).toBe(200);
  });
});
