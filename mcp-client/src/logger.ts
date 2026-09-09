/**
 * Minimal structured logger — a copy of `mcp-server/src/logger.ts`. Every level
 * goes to stderr so that in stdio mode the child server's JSON-RPC stream and
 * this CLI's own final answers (stdout) stay clean.
 *
 * Never pass secrets, connection strings, prompts, or raw model output to it.
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
