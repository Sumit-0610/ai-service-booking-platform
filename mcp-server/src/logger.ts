/**
 * Minimal structured logger — mirrors `apps/api/src/lib/logger.ts` but writes
 * *every* level to stderr. stdout is the MCP stdio transport (newline-delimited
 * JSON-RPC); a stray `console.log` there corrupts the protocol stream.
 *
 * Never pass secrets, connection strings, or raw tool arguments to it.
 */
type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  const entry = { level, message, time: new Date().toISOString(), ...meta };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
