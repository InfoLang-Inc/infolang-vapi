import { describe, expect, it } from "vitest";

import { normalizeIdentifier, voiceNamespace } from "../src/namespaces.js";
import { DEFAULT_NAMESPACE_PREFIX } from "../src/version.js";

describe("normalizeIdentifier", () => {
  it.each([
    ["+1 (555) 123-4567", "1-555-123-4567"],
    ["+15551234567", "15551234567"],
    ["USER_42", "user-42"],
    ["sip:alice@example.com", "sip-alice-example-com"],
    ["--Weird__Id!!", "weird-id"],
    ["  spaced  out  ", "spaced-out"],
  ])("normalizes %s -> %s", (raw, expected) => {
    expect(normalizeIdentifier(raw)).toBe(expected);
  });

  it.each(["", "   ", "+++", "@@@"])("rejects empty-ish %s", (bad) => {
    expect(() => normalizeIdentifier(bad)).toThrow();
  });
});

describe("voiceNamespace", () => {
  it("uses the default prefix", () => {
    expect(voiceNamespace("+15551234567")).toBe(`${DEFAULT_NAMESPACE_PREFIX}-15551234567`);
  });

  it("accepts a custom prefix", () => {
    expect(voiceNamespace("call-abc", "voice-call")).toBe("voice-call-call-abc");
  });

  it("is stable across formatting", () => {
    expect(voiceNamespace("+1 (555) 123-4567")).toBe(voiceNamespace("+1 (555) 123-4567"));
  });
});
