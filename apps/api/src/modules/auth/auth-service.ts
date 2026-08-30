import { repositories, type User } from '@aisbp/database';
import type { RegisterInput, Role, SessionUser } from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';

/**
 * A precomputed Argon2id hash of a random string. Login runs a verify against
 * this when the email is unknown, so response timing does not reveal whether an
 * account exists. No real password produces this hash.
 */
const TIMING_EQUALISER_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$4MXRFh3poIlB7peYj/IYpg$/fpEwkLqpvxrEN8Y6F/rEWOfaxxoM105uEb7zy40tHU';

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  };
}

export const authService = {
  /** Self-service registration always creates a `customer`. */
  async register(input: RegisterInput): Promise<SessionUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await repositories.users.create({
        email: input.email,
        name: input.name,
        passwordHash,
        role: 'customer',
      });
      return toSessionUser(user);
    } catch (error) {
      if (repositories.users.isUniqueEmailViolation(error)) {
        throw new AppError('EMAIL_TAKEN', 'That email address is already registered');
      }
      throw error;
    }
  },

  async verifyCredentials(email: string, password: string): Promise<SessionUser> {
    const user = await repositories.users.findByEmail(email);

    if (!user) {
      await verifyPassword(TIMING_EQUALISER_HASH, password);
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    return toSessionUser(user);
  },

  async loadUser(userId: string): Promise<SessionUser | null> {
    const user = await repositories.users.findById(userId);
    return user ? toSessionUser(user) : null;
  },
};
