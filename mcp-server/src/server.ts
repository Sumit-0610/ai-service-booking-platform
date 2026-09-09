import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Actor } from './context.js';
import { ToolError } from './errors.js';
import { logger } from './logger.js';
import {
  cancelOrRescheduleSchema,
  cancelOrRescheduleShape,
  checkAvailabilitySchema,
  checkAvailabilityShape,
  createBookingSchema,
  createBookingShape,
  getBookingDetailsSchema,
  getBookingDetailsShape,
} from './schemas.js';
import { mcpService } from './service.js';

/**
 * The MCP server and its four booking tools. `buildServer(actor)` is pure
 * wiring — no transport, no database connection — so the integration test can
 * drive it over an in-memory transport.
 *
 * Each tool: a permissive advertised input schema (see `schemas.ts` for why),
 * a full re-parse in the handler, and a description written for an LLM to
 * disambiguate — what it does, what it needs, and when to use it instead of a
 * sibling tool. All four operate as `actor`, the customer resolved at startup.
 */

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function failure(code: string, message: string, details?: unknown[]): CallToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: { code, message, details } }, null, 2) },
    ],
    isError: true,
  };
}

/**
 * Wraps a tool handler into the single error contract: a `ZodError` (bad
 * arguments) → `VALIDATION_ERROR`, a `ToolError` (domain failure) → its code,
 * anything else → logged and reported generically so nothing internal reaches
 * the model. Every branch returns *before* or instead of a database write.
 */
async function runTool(tool: string, handler: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await handler());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return failure(
        'VALIDATION_ERROR',
        'The tool arguments are invalid',
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    if (error instanceof ToolError) {
      return failure(error.code, error.message, error.details);
    }
    logger.error('Unhandled tool error', {
      tool,
      message: error instanceof Error ? error.message : String(error),
    });
    return failure('INTERNAL', 'The tool failed unexpectedly. Please try again.');
  }
}

export function buildServer(actor: Actor): McpServer {
  const server = new McpServer({ name: 'aisbp-booking-mcp', version: '0.1.0' });

  server.registerTool(
    'checkAvailability',
    {
      title: 'Check service availability',
      description:
        'Look up real open appointment slots for a service on a given day. Use this first, ' +
        'before createBooking, to get a concrete slotId. Returns each open slot with its ' +
        "start/end time, length, the assigned technician, and that technician's coverage " +
        'area. `serviceType` is a service slug or display name; `date` is a YYYY-MM-DD day ' +
        '(UTC); `location` optionally narrows results to technicians whose coverage area ' +
        'matches. Does not book anything.',
      inputSchema: checkAvailabilityShape,
    },
    (args) =>
      runTool('checkAvailability', () =>
        mcpService.checkAvailability(checkAvailabilitySchema.parse(args)),
      ),
  );

  server.registerTool(
    'createBooking',
    {
      title: 'Create a booking',
      description:
        'Book a specific open availability slot for the current customer. Requires a `slot` ' +
        "id from checkAvailability; `serviceType` must match the slot's service (a safety " +
        'cross-check, not a search). Pass `addressId` when the customer has more than one ' +
        'address on file. The booking is created with status "pending", priced from the ' +
        'current service price. Fails if the slot was taken in the meantime.',
      inputSchema: createBookingShape,
    },
    (args) =>
      runTool('createBooking', () =>
        mcpService.createBooking(actor, createBookingSchema.parse(args)),
      ),
  );

  server.registerTool(
    'getBookingDetails',
    {
      title: 'Get booking details',
      description:
        "Fetch one of the current customer's bookings by its `bookingId`: current status, " +
        'service, scheduled window, technician, service address, the frozen price ' +
        'breakdown, and the full status history. Read-only — use it to answer questions ' +
        'about a booking or to confirm the result of createBooking / cancelOrReschedule.',
      inputSchema: getBookingDetailsShape,
    },
    (args) =>
      runTool('getBookingDetails', () =>
        mcpService.getBookingDetails(actor, getBookingDetailsSchema.parse(args)),
      ),
  );

  server.registerTool(
    'cancelOrReschedule',
    {
      title: 'Cancel or reschedule a booking',
      description:
        'Change one of the current customer\'s bookings. `action: "cancel"` cancels it ' +
        '(allowed while pending, confirmed, or assigned). `action: "reschedule"` moves it ' +
        'to a different open slot — pass `newSlot` (a slotId from checkAvailability) for ' +
        'the *same* service; allowed only while the booking is pending or confirmed. The ' +
        'old slot is released and the price snapshot is kept. Returns the updated booking.',
      inputSchema: cancelOrRescheduleShape,
    },
    (args) =>
      runTool('cancelOrReschedule', () =>
        mcpService.cancelOrReschedule(actor, cancelOrRescheduleSchema.parse(args)),
      ),
  );

  return server;
}
