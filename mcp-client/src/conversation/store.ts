import { Redis } from 'ioredis';
import { z } from 'zod';
import type { LlmMessage } from '../llm/client.js';
import { logger } from '../logger.js';

/**
 * Persistent conversation state.
 *
 * The transcript is a *client* concept — `mcp-server` stays stateless (Week 2).
 * A conversation is keyed by a session id and stored in Redis as one JSON blob
 * with a sliding TTL, mirroring `apps/api/src/modules/session/session-store.ts`:
 *
 *  - validated with Zod on every read; a poisoned / truncated blob is treated
 *    as "no conversation", never trusted (Milestone 16 hardening),
 *  - **actor-bound**: a stored conversation records the `actorEmail` that
 *    created it, and `load()` refuses to hand it back to a different actor —
 *    you cannot resume someone else's conversation by guessing its id.
 *
 * Redis is optional. Without `REDIS_URL` the CLI uses `InMemoryConversationStore`
 * (this-process only); `--session` / `--new` require the Redis-backed store.
 */

const KEY_PREFIX = 'mcpconv:';

const llmToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  providerSignature: z.string().optional(),
});

const llmMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string().optional(),
  toolCalls: z.array(llmToolCallSchema).optional(),
  toolResults: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        response: z.unknown(),
        isError: z.boolean(),
      }),
    )
    .optional(),
});

const storedConversationSchema = z.object({
  actorEmail: z.string().min(1),
  messages: z.array(llmMessageSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export interface LoadResult {
  messages: LlmMessage[];
  /** true when a stored conversation was found and belongs to this actor. */
  resumed: boolean;
}

export class ConversationActorMismatchError extends Error {
  constructor(sessionId: string) {
    super(
      `Session "${sessionId}" belongs to a different customer. Start a new one (drop --session) ` +
        'or use the account that created it.',
    );
    this.name = 'ConversationActorMismatchError';
  }
}

export interface ConversationStore {
  readonly persistent: boolean;
  load(sessionId: string): Promise<LoadResult>;
  save(sessionId: string, messages: LlmMessage[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory (no Redis) — per-process, not shared, lost on exit.
// ---------------------------------------------------------------------------

export class InMemoryConversationStore implements ConversationStore {
  readonly persistent = false;
  private readonly byId = new Map<string, LlmMessage[]>();

  load(sessionId: string): Promise<LoadResult> {
    const messages = this.byId.get(sessionId);
    return Promise.resolve(
      messages
        ? { messages: structuredClone(messages), resumed: true }
        : { messages: [], resumed: false },
    );
  }

  save(sessionId: string, messages: LlmMessage[]): Promise<void> {
    this.byId.set(sessionId, structuredClone(messages));
    return Promise.resolve();
  }

  clear(sessionId: string): Promise<void> {
    this.byId.delete(sessionId);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Redis-backed
// ---------------------------------------------------------------------------

export class RedisConversationStore implements ConversationStore {
  readonly persistent = true;

  constructor(
    private readonly redis: Redis,
    private readonly actorEmail: string,
    private readonly ttlSeconds: number,
  ) {}

  static fromUrl(url: string, actorEmail: string, ttlSeconds: number): RedisConversationStore {
    const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    return new RedisConversationStore(redis, actorEmail, ttlSeconds);
  }

  async load(sessionId: string): Promise<LoadResult> {
    const raw = await this.redis.get(KEY_PREFIX + sessionId);
    if (!raw) {
      return { messages: [], resumed: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('discarded a corrupt conversation blob', { sessionId });
      return { messages: [], resumed: false };
    }

    const result = storedConversationSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn('discarded a malformed conversation blob', { sessionId });
      return { messages: [], resumed: false };
    }
    if (result.data.actorEmail !== this.actorEmail) {
      throw new ConversationActorMismatchError(sessionId);
    }

    await this.redis.expire(KEY_PREFIX + sessionId, this.ttlSeconds); // sliding
    return { messages: result.data.messages as LlmMessage[], resumed: true };
  }

  async save(sessionId: string, messages: LlmMessage[]): Promise<void> {
    const key = KEY_PREFIX + sessionId;
    const existingCreatedAt = await this.readCreatedAt(key);
    const now = new Date().toISOString();
    const blob = JSON.stringify({
      actorEmail: this.actorEmail,
      messages,
      createdAt: existingCreatedAt ?? now,
      updatedAt: now,
    });
    await this.redis.set(key, blob, 'EX', this.ttlSeconds);
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + sessionId);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private async readCreatedAt(key: string): Promise<string | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      const parsed = storedConversationSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.createdAt : null;
    } catch {
      return null;
    }
  }
}
