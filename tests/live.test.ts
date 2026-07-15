/**
 * Optional live smoke test against the real InfoLang API.
 *
 * Skipped unless INFOLANG_API_KEY is set. Only touches namespaces prefixed
 * `ittest-vapi-` and cleans up, so it is safe against a shared account.
 *
 *   INFOLANG_API_KEY=il_live_... npx vitest run tests/live.test.ts
 */

import { InfoLang } from "@infolang/sdk";
import { describe, expect, it } from "vitest";

import { voiceNamespace } from "../src/namespaces.js";

const apiKey = process.env.INFOLANG_API_KEY;

describe.skipIf(!apiKey)("live round trip", () => {
  it("remembers then recalls a caller memory", async () => {
    const namespace = voiceNamespace(Math.random().toString(36).slice(2, 10), "ittest-vapi");
    const client = new InfoLang({ apiKey: apiKey! });
    const stored = await client.remember("Caller: the passphrase is blue giraffe", {
      namespace,
      source: "vapi-smoke",
      tags: "voice,transcript",
    });
    expect(stored.memoryId).toBeTruthy();
    try {
      const recalled = await client.recall("passphrase", { namespace, topK: 5 });
      expect(recalled.chunks.some((chunk) => chunk.text.includes("giraffe"))).toBe(true);
    } finally {
      if (stored.memoryId) await client.forget(stored.memoryId, { namespace });
    }
  });
});
