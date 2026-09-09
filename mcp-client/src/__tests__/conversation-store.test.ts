import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConversationActorMismatchError,
  InMemoryConversationStore,
  RedisConversationStore,
} from '../conversation/store.js';
import type { LlmMessage } from '../llm/client.js';

const MESSAGES: LlmMessage[] = [
  { role: 'user', text: 'hi' },
  { role: 'model', toolCalls: [{ id: 'c1', name: 'checkAvailability', args: { date: 'x' } }] },
  {
    role: 'user',
    toolResults: [{ id: 'c1', name: 'checkAvailability', response: { slots: [] }, isError: false }],
  },
];

describe('InMemoryConversationStore', () => {
  it('round-trips per session and is not persistent', async () => {
    const store = new InMemoryConversationStore();
    expect(store.persistent).toBe(false);
    expect(await store.load('s1')).toEqual({ messages: [], resumed: false });

    await store.save('s1', MESSAGES);
    const loaded = await store.load('s1');
    expect(loaded.resumed).toBe(true);
    expect(loaded.messages).toEqual(MESSAGES);
    expect(loaded.messages).not.toBe(MESSAGES); // deep-cloned

    await store.clear('s1');
    expect(await store.load('s1')).toEqual({ messages: [], resumed: false });
  });
});

// Redis-backed: only runs when a reachable REDIS_URL is configured (CI has one).
const REDIS_URL = process.env.REDIS_URL;
const describeRedis = REDIS_URL ? describe : describe.skip;

describeRedis('RedisConversationStore', () => {
  const key = `redistest-${Date.now()}`;
  let raw: Redis;

  beforeAll(async () => {
    raw = new Redis(REDIS_URL!, { maxRetriesPerRequest: 2, lazyConnect: true });
    await raw.connect();
  });
  afterAll(async () => {
    await raw.del(`mcpconv:${key}`, `mcpconv:${key}-other`, `mcpconv:${key}-bad`);
    await raw.quit();
  });

  it('persists and resumes a conversation for its actor, with a sliding TTL', async () => {
    const store = new RedisConversationStore(raw, 'alice@example.com', 120);

    expect(await store.load(key)).toEqual({ messages: [], resumed: false });
    await store.save(key, MESSAGES);

    const loaded = await store.load(key);
    expect(loaded.resumed).toBe(true);
    expect(loaded.messages).toEqual(MESSAGES);

    const ttl = await raw.ttl(`mcpconv:${key}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('refuses to hand a conversation to a different actor', async () => {
    const owner = new RedisConversationStore(raw, 'alice@example.com', 120);
    await owner.save(`${key}-other`, MESSAGES);

    const intruder = new RedisConversationStore(raw, 'bob@example.com', 120);
    await expect(intruder.load(`${key}-other`)).rejects.toBeInstanceOf(
      ConversationActorMismatchError,
    );
  });

  it('treats a corrupt or malformed blob as a fresh conversation', async () => {
    const store = new RedisConversationStore(raw, 'alice@example.com', 120);
    await raw.set(`mcpconv:${key}-bad`, '{not json');
    expect(await store.load(`${key}-bad`)).toEqual({ messages: [], resumed: false });

    await raw.set(`mcpconv:${key}-bad`, JSON.stringify({ actorEmail: 'alice@example.com' })); // missing fields
    expect(await store.load(`${key}-bad`)).toEqual({ messages: [], resumed: false });
  });
});
