# @aisbp/mcp-server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the AI Service Booking Platform's booking workflow to an LLM agent as
four tools. It talks to the **same PostgreSQL database** as the REST API,
through the shared `@aisbp/database` repository layer — there is no mock data and
it does not import or start `apps/api`.

## Identity

The server acts for **one customer** for the life of the process — the same
model the GitHub / filesystem MCP servers use. That identity is
`AISBP_MCP_ACTOR_EMAIL`; it is resolved against the real `User` table at
startup, and the process refuses to start unless it names an existing
**customer** account. Every booking tool then operates as that customer and
cannot read or change another customer's rows.

> This holds for **both** transports below, including HTTP: every HTTP request
> acts as the one startup customer. Genuine per-request identity (a bearer
> token resolved to an `Actor` per call) is a later milestone; the `Actor` the
> tools depend on does not change.

## Transports

`MCP_TRANSPORT` selects the transport:

- **`stdio`** (default) — spawned by one client over stdin/stdout.
- **`http`** — Streamable HTTP on `MCP_HTTP_PORT` (default `3333`), path `/mcp`,
  loopback-bound. **Stateless**: every request gets a fresh transport (the SDK's
  required shape for stateless mode), so there is no session and independent
  clients are fine. SSE resumability is out of scope.

## Tools

| Tool                 | Arguments                                                    | What it does                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkAvailability`  | `serviceType`, `date` (`YYYY-MM-DD`, UTC), `location?`       | Real open slots for a service on a day, with technician + coverage area. Returns a `slotId` for `createBooking`.                                                                                                                                                                                                |
| `createBooking`      | `serviceType`, `slot` (slotId), `addressId?`                 | Books the slot for the acting customer, status `pending`, priced from the current service price. `addressId` is required only when the customer has more than one address on file. Reuses `bookingRepository.createForCustomer` (transaction + `Booking.slotId` UNIQUE double-booking guard).                   |
| `getBookingDetails`  | `bookingId`                                                  | Read-only: status, schedule, technician, address, frozen price breakdown, status history. Scoped to the acting customer (another customer's id → not found).                                                                                                                                                    |
| `cancelOrReschedule` | `bookingId`, `action` (`cancel` \| `reschedule`), `newSlot?` | `cancel` runs the owner-scoped cancel transaction (pending/confirmed/assigned). `reschedule` moves the booking to another open slot of the same service — **pending or confirmed only** (an assigned booking has a technician committed; that goes through operations). Old slot released, price snapshot kept. |

### Error contract

Every tool validates its arguments with a Zod schema **before any database
call** and returns failures as an MCP `isError` result carrying the same
`{ error: { code, message, details? } }` envelope the REST API uses
(`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`). The advertised input
schema is kept permissive on purpose so that malformed and cross-field errors
both come back through this one path rather than the SDK's own `-32602` string.

## Run

```bash
# from the repo root, with a migrated + seeded database
pnpm --filter @aisbp/mcp-server build
DATABASE_URL=postgresql://... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
  node mcp-server/dist/index.js                          # stdio (default)

MCP_TRANSPORT=http MCP_HTTP_PORT=3333 \
  DATABASE_URL=postgresql://... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
  node mcp-server/dist/index.js                          # Streamable HTTP on :3333/mcp
```

Register it with an MCP client (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "aisbp-booking": {
      "command": "node",
      "args": ["/abs/path/to/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "AISBP_MCP_ACTOR_EMAIL": "customer@example.com"
      }
    }
  }
}
```

## Verify

```bash
# lists the 4 tools and calls checkAvailability against the real DB
DATABASE_URL=... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
  pnpm --filter @aisbp/mcp-server smoke

# full integration suite (needs the seeded DB, same as @aisbp/database tests) —
# also runs in CI's `validate` job via `pnpm test:coverage`
DATABASE_URL=... pnpm --filter @aisbp/mcp-server test
```
