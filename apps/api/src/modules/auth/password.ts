import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters. Aligned with the OWASP Password Storage Cheat Sheet
 * (m = 19 MiB, t = 2, p = 1). The parameters are also encoded in the hash
 * string, so `verify` does not need them passed back in.
 */
const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await verify(hashString, password);
  } catch {
    // Malformed hash string, etc. Treat as a failed verification, never throw.
    return false;
  }
}
