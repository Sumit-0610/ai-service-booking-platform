import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import {
  jsonSchemaToGeminiSchema,
  toFunctionDeclarations,
  type GeminiSchema,
} from '../llm/schema.js';

/**
 * Pure unit tests for the MCP-JSON-Schema -> Gemini-schema bridge. No DB, no
 * network. The `TOOLS` fixture mirrors what `client.listTools()` actually
 * returns for the booking server (draft-07, `$schema` present, `serviceType`
 * carries `minLength`/`maxLength`, no `additionalProperties`).
 */

const TOOLS: Tool[] = [
  {
    name: 'checkAvailability',
    description: 'Look up real open appointment slots for a service on a given day.',
    inputSchema: {
      type: 'object',
      properties: {
        serviceType: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'A service slug or name.',
        },
        date: { type: 'string', description: 'YYYY-MM-DD (UTC).' },
        location: { type: 'string', description: 'Optional service area.' },
      },
      required: ['serviceType', 'date'],
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
  {
    name: 'cancelOrReschedule',
    description: "Cancel or reschedule one of the customer's bookings.",
    inputSchema: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'The booking id.' },
        action: { type: 'string', description: 'One of "cancel" or "reschedule".' },
        newSlot: { type: 'string', description: 'Required when rescheduling.' },
      },
      required: ['bookingId', 'action'],
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
];

function deepKeys(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((n) => deepKeys(n, found));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      found.add(k);
      deepKeys(v, found);
    }
  }
  return found;
}

describe('toFunctionDeclarations', () => {
  const declarations = toFunctionDeclarations(TOOLS);

  it('maps every tool to a name + description + object parameters', () => {
    expect(declarations.map((d) => d.name)).toEqual(['checkAvailability', 'cancelOrReschedule']);
    for (const decl of declarations) {
      expect(decl.description.length).toBeGreaterThan(10);
      expect(decl.parameters.type).toBe('object');
      expect(decl.parameters.properties).toBeDefined();
    }
  });

  it('preserves required and property descriptions', () => {
    const check = declarations[0]!.parameters;
    expect(check.required).toEqual(['serviceType', 'date']);
    expect(check.properties?.['location']).toBeDefined();
    expect(check.required).not.toContain('location');
    expect(check.properties?.['serviceType']?.description).toContain('service slug');
  });

  it('strips JSON Schema keywords Gemini rejects', () => {
    const keys = deepKeys(declarations);
    for (const banned of ['$schema', 'minLength', 'maxLength', 'additionalProperties', 'pattern']) {
      expect(keys.has(banned), `expected "${banned}" to be stripped`).toBe(false);
    }
  });
});

describe('jsonSchemaToGeminiSchema', () => {
  it('collapses anyOf: [T, null] to T + nullable, keeping the outer description', () => {
    const result = jsonSchemaToGeminiSchema({
      description: 'an optional note',
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    expect(result).toEqual<GeminiSchema>({
      type: 'string',
      nullable: true,
      description: 'an optional note',
    });
  });

  it('collapses a ["string","null"] type array to string + nullable', () => {
    expect(jsonSchemaToGeminiSchema({ type: ['string', 'null'] })).toEqual<GeminiSchema>({
      type: 'string',
      nullable: true,
    });
  });

  it('keeps enum + date-time format but drops other formats', () => {
    expect(jsonSchemaToGeminiSchema({ type: 'string', enum: ['a', 'b'] })).toMatchObject({
      type: 'string',
      enum: ['a', 'b'],
    });
    expect(jsonSchemaToGeminiSchema({ type: 'string', format: 'date-time' }).format).toBe(
      'date-time',
    );
    expect(jsonSchemaToGeminiSchema({ type: 'string', format: 'email' }).format).toBeUndefined();
  });

  it('infers object/array type from properties/items', () => {
    expect(jsonSchemaToGeminiSchema({ properties: { a: { type: 'string' } } }).type).toBe('object');
    expect(jsonSchemaToGeminiSchema({ items: { type: 'number' } }).type).toBe('array');
  });
});
