# @aisbp/mcp-client

A standalone terminal chat agent that connects a **Gemini** LLM to the
[`@aisbp/mcp-server`](../mcp-server) booking tools and runs the full loop:

```
your message → Gemini → tool_use → call the MCP tool → tool_result → Gemini → answer
```

Every tool call hits the real database through the MCP server. No `apps/api`.

> **Status:** Week 2 scaffold. Single user, single actor (see the server's
> caveat). Built for demoing and explaining the tool-call loop, not production.

## Setup

Get a free Gemini API key at <https://aistudio.google.com/apikey>, then:

```bash
export GEMINI_API_KEY=...
export DATABASE_URL=postgresql://...            # the migrated + seeded platform DB
export AISBP_MCP_ACTOR_EMAIL=alice@example.com  # an existing customer
```

| Variable                                | Default            | Notes                                                                            |
| --------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                        | —                  | Free-tier key. Without it the CLI exits (use `--scripted`).                      |
| `GEMINI_MODEL`                          | `gemini-2.0-flash` | Any function-calling Gemini model. `--model` overrides.                          |
| `MCP_TRANSPORT`                         | `stdio`            | `stdio` \| `memory` \| `http`. `--stdio` / `--memory` / `--http <url>` override. |
| `MCP_SERVER_URL`                        | —                  | Required for `http`. `--http <url>` sets it.                                     |
| `MCP_AGENT_MAX_ITERATIONS`              | `8`                | Hard cap on model↔tool round trips per turn.                                     |
| `DATABASE_URL`, `AISBP_MCP_ACTOR_EMAIL` | —                  | Needed by `stdio`/`memory` (they run the server); not by `http`.                 |

## Run

```bash
pnpm --filter @aisbp/mcp-server build      # required for the stdio transport
pnpm --filter @aisbp/mcp-client chat
# you › what washing machine installation slots are open on 2026-09-10?
#   (stderr) → checkAvailability {...}   ← 3 slots
# you › book the earliest one
#   (stderr) → createBooking {...}       ← booking <id> pending
#   (stdout) bot › Booked — appointment <id> is pending for <time>.
```

The step trace goes to **stderr**; only `bot ›` answers go to **stdout**.

### Transports

- **`stdio`** (default) — spawns the built `mcp-server` (`dist/index.js`) as a child process. The realistic "client talks to a standalone server" path.
- **`memory`** — runs the booking server in-process. No build, fastest; used by the tests. `--memory`.
- **`http`** — connects to an already-running server's Streamable HTTP endpoint:
  ```bash
  # terminal A
  MCP_TRANSPORT=http MCP_HTTP_PORT=3333 \
    DATABASE_URL=... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
    pnpm --filter @aisbp/mcp-server start
  # terminal B
  GEMINI_API_KEY=... pnpm --filter @aisbp/mcp-client chat -- --http http://localhost:3333/mcp
  ```

### `--scripted`

Runs a fixed check-then-book flow with a deterministic in-process fake LLM — no
API key, no network. Useful for smoke-testing a transport or demoing offline.

## How it works

- `src/llm/` — the LLM boundary, modelled on `apps/api/src/lib/claude.ts`: a
  provider-neutral `LlmClient` interface, `realGeminiClient`, a memoised
  `getLlmClient()` that returns `null` without a key, `setLlmClientForTesting`,
  and a `scriptedLlmClient` fake. `schema.ts` converts each MCP tool's JSON
  Schema into the OpenAPI-3 subset Gemini accepts (by hand, not via
  `@google/genai`'s `mcpToTool`, which hides the loop this project demonstrates).
- `src/agent/loop.ts` — the loop. Server-authoritative: a hallucinated `slot`
  id comes back as a `VALIDATION_ERROR` which is fed to the model to recover
  from, rather than being blocked client-side. Only hard guard is
  `maxIterations`.
- `src/mcp/connect.ts` — the three transports.

## Test

```bash
DATABASE_URL=... pnpm --filter @aisbp/mcp-client test
```

- `config.test.ts`, `transcript.test.ts`, `schema.test.ts` — pure.
- `gemini.test.ts` — drives `geminiClientFromGenerator` with a **fake**
  `generateContent`: request mapping (system / tools / AUTO), response parsing
  (tool calls, text, usage), the retry policy, and the `output`/`error`
  function-response convention. No network, no key.
- `loop.test.ts` — the loop's control flow with a fake MCP client (iteration
  cap, multi-call turns, unknown tool, transport failure).
- `loop.integration.test.ts` — the whole loop against the **real** MCP server
  (in-memory) + real DB with a scripted LLM; asserts a real `pending` booking
  row. **No Gemini call in CI.** Runs via the recursive `pnpm test:coverage`.

### Real Gemini check (the one thing tests can't do)

```bash
GEMINI_API_KEY=... DATABASE_URL=... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
  pnpm --filter @aisbp/mcp-client verify:gemini
```

Runs one real turn against the live API and exits non-zero unless the model
actually called `checkAvailability` against the real DB.
