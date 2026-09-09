import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Convert the JSON Schema an MCP server advertises for each tool
 * (`client.listTools()`) into the OpenAPI-3 subset a Gemini
 * `FunctionDeclaration` accepts.
 *
 * We do this by hand rather than with `@google/genai`'s `mcpToTool(client)`
 * helper because that helper runs its *own* hidden tool-call loop inside
 * `generateContent` and returns only the final text — which erases exactly the
 * `tool_use -> execute -> tool_result -> model` cycle this project is meant to
 * demonstrate, and bypasses the `setLlmClientForTesting` seam (forcing a live
 * API in CI). Four hand-written tool schemas cost ~40 lines.
 *
 * Gemini rejects JSON Schema keywords outside its subset, so we keep only
 * `type` / `description` / `properties` / `items` / `required` / `enum` /
 * `nullable`, drop `$schema` / `additionalProperties` / `$ref` / `format`
 * (except `date-time`) / `minLength` / `maxLength` / `pattern` / `minimum` /
 * `maximum` / `default`, and collapse `anyOf: [T, {type:'null'}]` (how an
 * optional Zod field can serialise) to `T` with `nullable: true`.
 */

export interface GeminiSchema {
  type?: string;
  description?: string;
  nullable?: boolean;
  enum?: unknown[];
  format?: string;
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: GeminiSchema;
}

const KEPT_STRING_FORMATS = new Set(['date-time', 'enum']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Recursively sanitise one JSON Schema node into a `GeminiSchema`. */
export function jsonSchemaToGeminiSchema(node: unknown): GeminiSchema {
  const obj = asRecord(node);
  if (!obj) {
    return { type: 'string' };
  }

  // anyOf / oneOf of [T, null] -> T + nullable
  for (const key of ['anyOf', 'oneOf'] as const) {
    const variants = obj[key];
    if (Array.isArray(variants)) {
      const nonNull = variants.filter((v) => asRecord(v)?.['type'] !== 'null');
      const hasNull = variants.length !== nonNull.length;
      const base = jsonSchemaToGeminiSchema(nonNull[0] ?? {});
      if (typeof obj['description'] === 'string' && !base.description) {
        base.description = obj['description'];
      }
      if (hasNull) base.nullable = true;
      return base;
    }
  }

  const out: GeminiSchema = {};

  const rawType = obj['type'];
  if (typeof rawType === 'string') {
    out.type = rawType;
  } else if (Array.isArray(rawType)) {
    // ['string','null'] -> string + nullable
    const nonNull = rawType.filter((t) => t !== 'null');
    if (nonNull[0]) out.type = String(nonNull[0]);
    if (nonNull.length !== rawType.length) out.nullable = true;
  }

  if (typeof obj['description'] === 'string') out.description = obj['description'];
  if (obj['nullable'] === true) out.nullable = true;
  if (Array.isArray(obj['enum'])) out.enum = obj['enum'];
  if (typeof obj['format'] === 'string' && KEPT_STRING_FORMATS.has(obj['format'])) {
    out.format = obj['format'];
  }

  const properties = asRecord(obj['properties']);
  if (properties) {
    out.type ??= 'object';
    out.properties = {};
    for (const [name, child] of Object.entries(properties)) {
      out.properties[name] = jsonSchemaToGeminiSchema(child);
    }
  }
  if (Array.isArray(obj['required'])) {
    out.required = obj['required'].filter((r): r is string => typeof r === 'string');
  }
  if (obj['items'] !== undefined) {
    out.type ??= 'array';
    out.items = jsonSchemaToGeminiSchema(obj['items']);
  }

  return out;
}

export function toFunctionDeclaration(tool: Tool): ToolDeclaration {
  return {
    name: tool.name,
    description: tool.description ?? '',
    parameters: jsonSchemaToGeminiSchema(tool.inputSchema),
  };
}

export function toFunctionDeclarations(tools: Tool[]): ToolDeclaration[] {
  return tools.map(toFunctionDeclaration);
}
