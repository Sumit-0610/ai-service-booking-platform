import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';
import type { Role, User } from '../../generated/prisma/index.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
}

/**
 * Data access for users. The authentication service uses this; it never touches
 * Prisma directly. `passwordHash` is part of the row and callers are
 * responsible for not leaking it past the service boundary.
 */
export const userRepository = {
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async create(input: CreateUserInput): Promise<User> {
    return prisma.user.create({ data: input });
  },

  /** True when the create failed because the email is already registered. */
  isUniqueEmailViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (error.meta?.target as string[] | undefined)?.includes('email') === true
    );
  },
};
