/** Package version and shared defaults. */

export const version = "0.1.0";

/** InfoLang's confidence floor: recall below this is "weak". */
export const CONFIDENCE_FLOOR = 0.85;

/** Default tool names the assistant calls mid-conversation. */
export const DEFAULT_RECALL_TOOL = "recall_memory";
export const DEFAULT_REMEMBER_TOOL = "remember_memory";

/** Default provenance tag written on stored memories. */
export const DEFAULT_SOURCE = "vapi";

/** Default namespace prefix for the per-caller bank. */
export const DEFAULT_NAMESPACE_PREFIX = "voice-caller";

/**
 * Default recall latency budget (ms). Vapi enforces a hard 7.5s end-to-end cap
 * on `assistant-request`; we stay well under it and fail open on timeout.
 */
export const DEFAULT_RECALL_TIMEOUT_MS = 1500;

/** Default number of memories to recall. */
export const DEFAULT_TOP_K = 6;

/** Default prefix line for the injected memory system message. */
export const DEFAULT_SYSTEM_PROMPT =
  "Relevant details this caller shared in earlier conversations:";

/**
 * Default query used to pull caller context at call start (`assistant-request`).
 * There is no user utterance yet, so we recall broadly against the caller bank.
 */
export const DEFAULT_START_QUERY = "important facts, preferences, and context about this caller";
