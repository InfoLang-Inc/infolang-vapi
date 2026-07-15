/**
 * InfoLang semantic memory for Vapi voice agents.
 *
 * A Cloudflare Workers-deployable webhook that recalls caller context at call
 * start (`assistant-request`), serves `recall`/`remember` tool calls during the
 * call (`tool-calls`), and remembers the transcript at call end
 * (`end-of-call-report`). Built on the public `@infolang/sdk`.
 *
 * @example
 * ```ts
 * import { InfoLang } from "@infolang/sdk";
 * import { createVapiMemoryHandler } from "infolang-vapi";
 *
 * const handler = createVapiMemoryHandler({
 *   client: new InfoLang({ apiKey: process.env.INFOLANG_API_KEY! }),
 *   secret: process.env.VAPI_SECRET,
 *   assistant: myBaseAssistant,
 * });
 *
 * // In any Web `Request`/`Response` runtime:
 * const response = await handler.handleRequest(request);
 * ```
 */

export { createVapiMemoryHandler, type VapiMemoryHandler } from "./handler.js";
export {
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
} from "./memory.js";
export { normalizeIdentifier, voiceNamespace } from "./namespaces.js";
export type {
  VapiAssistant,
  VapiCall,
  VapiHandlerResult,
  VapiMemoryOptions,
  VapiMessage,
  VapiToolCall,
  VapiToolResult,
  VapiWebhookBody,
} from "./types.js";
export {
  CONFIDENCE_FLOOR,
  DEFAULT_NAMESPACE_PREFIX,
  DEFAULT_RECALL_TIMEOUT_MS,
  DEFAULT_RECALL_TOOL,
  DEFAULT_REMEMBER_TOOL,
  DEFAULT_SOURCE,
  DEFAULT_START_QUERY,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOP_K,
  version,
} from "./version.js";
export {
  createFetch,
  type Env,
  EXAMPLE_ASSISTANT,
  type ExecutionContext,
  type WorkerDeps,
} from "./worker.js";
