/**
 * Session -> namespace mapping for Vapi voice memory.
 *
 * InfoLang scopes memory on two axes: **workspace** (tenant, set once on the
 * client) and **namespace** (bank, per-recall/per-write). For voice, the
 * namespace is the session mapping: each caller gets a stable bank keyed by
 * their phone number (or any caller id) so a returning caller recalls their own
 * history and nobody else's.
 */

import { DEFAULT_NAMESPACE_PREFIX } from "./version.js";

const UNSAFE = /[^a-z0-9]+/g;
const TRIM = /^-+|-+$/g;

/**
 * Lower-case `identifier` and collapse unsafe runs into single hyphens, so
 * phone numbers, SIP URIs, and user ids become stable `[a-z0-9-]` slugs.
 *
 * @throws if `identifier` is empty or has no usable characters.
 */
export function normalizeIdentifier(identifier: string): string {
  if (!identifier || !identifier.trim()) {
    throw new Error("identifier must be a non-empty string");
  }
  const slug = identifier.trim().toLowerCase().replace(UNSAFE, "-").replace(TRIM, "");
  if (!slug) {
    throw new Error(`identifier ${JSON.stringify(identifier)} has no usable characters`);
  }
  return slug;
}

/**
 * Build a stable namespace for a caller/session `identifier`.
 *
 * @param identifier caller key (phone number, SIP URI, call id, user id).
 * @param prefix namespace prefix grouping all voice banks.
 * @returns `"<prefix>-<identifier>"`, normalized to `[a-z0-9-]`.
 */
export function voiceNamespace(
  identifier: string,
  prefix: string = DEFAULT_NAMESPACE_PREFIX,
): string {
  return `${normalizeIdentifier(prefix)}-${normalizeIdentifier(identifier)}`;
}
