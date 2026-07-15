# infolang-vapi

InfoLang semantic memory for [Vapi](https://vapi.ai) voice agents. A small
webhook that gives a Vapi assistant a long-term memory:

- **Recall at call start** — on `assistant-request`, recall the caller's prior
  context and inject it into the transient assistant's system prompt.
- **Recall + remember mid-call** — serve `recall_memory` / `remember_memory`
  tool calls so the assistant can look things up and save facts during the call.
- **Remember at call end** — on `end-of-call-report`, store the transcript keyed
  by caller, so a caller who hangs up and calls back is remembered.

Built entirely on the **public** InfoLang TypeScript SDK
([`@infolang/sdk`](https://www.npmjs.com/package/@infolang/sdk)). No runtime or
engine internals.

- **Verified against:** `@infolang/sdk` 0.2.x, Vapi Server URL events
  ([docs](https://docs.vapi.ai/server-url/events)), Cloudflare Workers runtime.
- **Status:** Alpha. Mock-tested offline; live probe is opt-in (see below).

## Why TypeScript on Cloudflare Workers?

Vapi has **no Python/TS in-process SDK for its runtime** — the integration
surface is a **server webhook** (the assistant's *Server URL*) plus **tool
calls**. Vapi enforces a hard latency budget on `assistant-request` (≈7.5s
end-to-end), so recall must be fast. A Cloudflare Worker runs at the edge,
close to Vapi, cold-starts in milliseconds, and speaks the Web
`Request`/`Response` API the handler is written against. TypeScript with
`@infolang/sdk@^0.2` is therefore the idiomatic choice; the handler itself is
transport-agnostic (`handleRequest(request)`), so it also runs on Node, Deno,
Bun, or any Fetch-compatible host.

## Install

```bash
npm install infolang-vapi @infolang/sdk
```

## Quickstart (Cloudflare Workers)

1. Set your credentials as Worker secrets:

```bash
npx wrangler secret put INFOLANG_API_KEY   # il_live_...
npx wrangler secret put VAPI_SECRET         # any strong shared secret
```

2. Use the bundled Worker entry (`infolang-vapi/worker`) or wire your own:

```ts
// src/worker.ts
export { default } from "infolang-vapi/worker";
```

3. Deploy and point Vapi at the URL:

```bash
npm run deploy   # wrangler deploy -> https://infolang-vapi.<subdomain>.workers.dev
```

### Custom wiring

`createFetch` lets you inject the client, the base assistant, and the secret
source:

```ts
import { InfoLang } from "@infolang/sdk";
import { createFetch, type Env } from "infolang-vapi/worker";

export default {
  fetch: createFetch({
    createClient: (env: Env) =>
      new InfoLang({ apiKey: env.INFOLANG_API_KEY, workspace: env.INFOLANG_WORKSPACE }),
    assistant: myBaseAssistant,        // static object or (message) => assistant
    secret: (env) => env.VAPI_SECRET,  // constant-time checked against X-Vapi-Secret
  }),
};
```

### Any Fetch runtime (Node / Deno / Bun)

The handler is transport-agnostic:

```ts
import { InfoLang } from "@infolang/sdk";
import { createVapiMemoryHandler } from "infolang-vapi";

const handler = createVapiMemoryHandler({
  client: new InfoLang({ apiKey: process.env.INFOLANG_API_KEY! }),
  secret: process.env.VAPI_SECRET,
  assistant: myBaseAssistant,
});

// e.g. inside your HTTP framework:
const response = await handler.handleRequest(request); // Web Request -> Response
```

## Vapi assistant configuration

Point your assistant's **Server URL** at the deployed Worker and set the same
secret. To let the model recall/save memory *during* the call, register the two
tools. Drop this into your assistant config (values other than `type`/`function`
are yours to tune):

```json
{
  "serverUrl": "https://infolang-vapi.<subdomain>.workers.dev/",
  "serverUrlSecret": "the same value you set as VAPI_SECRET",
  "model": {
    "provider": "openai",
    "model": "gpt-4o",
    "messages": [
      { "role": "system", "content": "You are a helpful, concise voice assistant. Use any provided caller memory to personalize the conversation." }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "recall_memory",
          "description": "Look up facts this caller shared in earlier conversations.",
          "parameters": {
            "type": "object",
            "properties": {
              "query": { "type": "string", "description": "What to look up." },
              "top_k": { "type": "number", "description": "Max results (optional)." }
            },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "remember_memory",
          "description": "Save a durable fact about this caller for future calls.",
          "parameters": {
            "type": "object",
            "properties": {
              "text": { "type": "string", "description": "The fact to remember." },
              "tags": { "type": "string", "description": "Optional comma-separated tags." }
            },
            "required": ["text"]
          }
        }
      }
    ]
  }
}
```

If you only want start/end memory (recall on `assistant-request`, remember on
`end-of-call-report`), omit the tools — those paths need no assistant config.
The tool names are configurable/disable-able via the `tools` option; the
defaults above match `recall_memory` / `remember_memory`.

## How it works

| Vapi event | Handler action |
| --- | --- |
| `assistant-request` | Recall the caller bank (budgeted, fail-open) and inject a single system message with the results into the returned transient `assistant`. |
| `tool-calls` | Route `recall_memory` → `recall`, `remember_memory` → `remember`. Each tool result is returned per `toolCallId`; per-tool errors become a spoken failure string, never a batch failure. |
| `end-of-call-report` | Remember the transcript/summary keyed by caller (`tags: voice,transcript`). Fail-open. |
| anything else | `200`, no-op. |

**Fail-open everywhere.** Recall is time-boxed by `recallTimeoutMs` and returns
no memory on timeout/error rather than blocking the call. Remember errors are
swallowed (with an optional `onError` hook). `handleRequest` always returns
`200` on unexpected errors to avoid Vapi retry storms.

### Options (`createVapiMemoryHandler`)

| Option | Default | Purpose |
| --- | --- | --- |
| `client` | — | InfoLang client (workspace = tenant). Required. |
| `secret` | none | Shared secret; constant-time checked against `X-Vapi-Secret`. |
| `assistant` | none | Base transient assistant (object or factory) to inject memory into. |
| `namespace` / `namespaceFor` | per-caller | Fixed or dynamic bank; see below. |
| `callerIdFrom` | customer number | Override caller-id extraction. |
| `namespacePrefix` | `voice-caller` | Prefix when deriving a bank from the caller id. |
| `recallQuery` | broad caller query | Query used at call start (no utterance yet). |
| `topK` | `6` | Max memories recalled per call/tool. |
| `recallTimeoutMs` | `1500` | Recall latency budget (fail-open). |
| `source` | `vapi` | Provenance tag on stored memories. |
| `tools` | `{recall, remember}` | Rename (`string`) or disable (`false`) each tool. |
| `onError` | none | Error hook `(error, context)`; never throws into the response. |

## Session → namespace (workspace vs. namespace)

InfoLang scopes memory on two axes:

- **workspace = tenant.** Set once on the client (`workspace` /
  `INFOLANG_WORKSPACE`). Isolates customers/apps. A managed API key must
  allowlist the workspace.
- **namespace = bank.** The per-caller partition — the **session mapping**. By
  default this handler derives `voice-caller-<caller-id>` from the caller's phone
  number (`customer.number`, then call fallbacks, then `call.id`), so returning
  callers recall their own history and nobody else's. Override with `namespace`
  (fixed) or `namespaceFor(message)` (dynamic, e.g. per business line).

A managed API key honors the `namespace` argument on both reads and writes; a
self-hosted dev key is pinned to a single namespace.

## Security & privacy

- Voice transcripts are **PII**. Each turn/transcript is stored verbatim in the
  namespace you choose — segregate callers with per-caller namespaces and
  tenants with workspaces, and apply your own retention (remove with
  `client.forget(...)`).
- Set `VAPI_SECRET` and Vapi's `serverUrlSecret` to the same value: requests are
  authenticated via a **constant-time** compare of the `X-Vapi-Secret` header.
- The handler talks only to the InfoLang public API over HTTPS via the SDK. No
  credentials or payloads are logged.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test          # offline; mocks the InfoLang client and Vapi payloads
npm run build
```

The default suite is fully offline. The opt-in live probe hits the real API and
only runs when `INFOLANG_API_KEY` is set:

```bash
INFOLANG_API_KEY=il_live_... npx vitest run tests/live.test.ts
```

Coverage gate: **90%** line + branch on `src` (enforced in CI; the suite
currently reports 100%).

## License

Apache-2.0.
