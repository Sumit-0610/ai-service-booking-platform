import { describe, expect, it } from 'vitest';
import { loadClientConfig } from '../config.js';

/** Pure config tests — env parsing, flag overlay, cross-field validation. */

const BASE = {
  DATABASE_URL: 'postgresql://localhost/db',
  AISBP_MCP_ACTOR_EMAIL: 'Alice@Example.com',
} as NodeJS.ProcessEnv;

const argv = (...flags: string[]): string[] => ['node', 'cli', ...flags];

describe('loadClientConfig', () => {
  it('applies defaults', () => {
    const c = loadClientConfig(argv(), BASE);
    expect(c.transport).toBe('stdio');
    expect(c.geminiModel).toBe('gemini-flash-latest');
    expect(c.maxIterations).toBe(8);
    expect(c.actorEmail).toBe('alice@example.com'); // lowercased
    expect(c.scripted).toBe(false);
  });

  it('reads env and lets flags override', () => {
    const c = loadClientConfig(
      argv('--memory', '--model', 'gemini-2.5-flash', '--max-iterations', '3'),
      {
        ...BASE,
        MCP_TRANSPORT: 'http',
        MCP_SERVER_URL: 'http://x/mcp',
        GEMINI_MODEL: 'from-env',
      },
    );
    expect(c.transport).toBe('memory');
    expect(c.geminiModel).toBe('gemini-2.5-flash');
    expect(c.maxIterations).toBe(3);
  });

  it('--http sets transport + url', () => {
    const c = loadClientConfig(argv('--http', 'http://localhost:3333/mcp'), BASE);
    expect(c.transport).toBe('http');
    expect(c.serverUrl).toBe('http://localhost:3333/mcp');
  });

  it('rejects http without a url', () => {
    expect(() => loadClientConfig(argv(), { ...BASE, MCP_TRANSPORT: 'http' })).toThrow(
      /server URL/,
    );
  });

  it('rejects stdio/memory without DATABASE_URL + actor email', () => {
    expect(() => loadClientConfig(argv('--memory'), {})).toThrow(
      /DATABASE_URL and AISBP_MCP_ACTOR_EMAIL/,
    );
  });

  it('does not require DB/actor for http', () => {
    const c = loadClientConfig(argv('--http', 'http://x/mcp'), {});
    expect(c.transport).toBe('http');
  });

  it('rejects a flag that needs a value but has none', () => {
    expect(() => loadClientConfig(argv('--http'), BASE)).toThrow(/--http needs a value/);
  });

  it('rejects a non-positive --max-iterations', () => {
    expect(() => loadClientConfig(argv('--max-iterations', '0'), BASE)).toThrow(/positive integer/);
  });

  it('carries scripted through', () => {
    expect(loadClientConfig(argv('--scripted'), BASE).scripted).toBe(true);
  });

  it('leaves sessionId undefined (in-memory) with no --session / --new', () => {
    expect(loadClientConfig(argv(), BASE).sessionId).toBeUndefined();
  });

  it('rejects --session / --new without REDIS_URL', () => {
    expect(() => loadClientConfig(argv('--session', 'abc'), BASE)).toThrow(/REDIS_URL/);
    expect(() => loadClientConfig(argv('--new'), BASE)).toThrow(/REDIS_URL/);
  });

  it('uses the given session id when REDIS_URL is set; mints one for --new', () => {
    const redis = { ...BASE, REDIS_URL: 'redis://localhost:6379' };
    expect(loadClientConfig(argv('--session', 'sess-1'), redis).sessionId).toBe('sess-1');
    expect(loadClientConfig(argv('--new'), redis).sessionId).toMatch(/[0-9a-f-]{36}/);
  });

  it('--yes sets autoApproveWrites', () => {
    expect(loadClientConfig(argv('--yes'), BASE).autoApproveWrites).toBe(true);
    expect(loadClientConfig(argv(), BASE).autoApproveWrites).toBe(false);
  });
});
