import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Data access for customer addresses. Every operation is scoped to the owning
 * user id, so a customer can never reach another customer's address by id. The
 * select is narrow: `userId` and timestamps never leave this layer.
 */

const addressSelect = {
  id: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
} satisfies Prisma.AddressSelect;

export type AddressRow = Prisma.AddressGetPayload<{ select: typeof addressSelect }>;

/** Only these fields may ever be written from a request. */
export interface AddressWriteInput {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/** A partial update; `undefined` values are left untouched by Prisma. */
export type AddressUpdateInput = {
  [K in keyof AddressWriteInput]?: AddressWriteInput[K] | undefined;
};

export const addressRepository = {
  listByUser(userId: string): Promise<AddressRow[]> {
    return prisma.address.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: addressSelect,
    });
  },

  findByIdForUser(id: string, userId: string): Promise<AddressRow | null> {
    return prisma.address.findFirst({ where: { id, userId }, select: addressSelect });
  },

  create(userId: string, data: AddressWriteInput): Promise<AddressRow> {
    return prisma.address.create({ data: { ...data, userId }, select: addressSelect });
  },

  /** Returns null when the address does not exist or is not owned by `userId`. */
  async updateForUser(
    id: string,
    userId: string,
    data: AddressUpdateInput,
  ): Promise<AddressRow | null> {
    // Build the update payload from an explicit field allow-list. Undefined
    // fields are left untouched; nothing else from the caller is forwarded.
    const patch: Prisma.AddressUpdateInput = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.line1 !== undefined) patch.line1 = data.line1;
    if (data.line2 !== undefined) patch.line2 = data.line2;
    if (data.city !== undefined) patch.city = data.city;
    if (data.state !== undefined) patch.state = data.state;
    if (data.postalCode !== undefined) patch.postalCode = data.postalCode;
    if (data.country !== undefined) patch.country = data.country;

    try {
      return await prisma.address.update({
        where: { id, userId },
        data: patch,
        select: addressSelect,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Returns:
   *  - `'deleted'` on success,
   *  - `'not_found'` when the address does not exist or is not owned by `userId`,
   *  - `'in_use'` when a booking still references it (the FK is `onDelete: Restrict`).
   */
  async deleteForUser(id: string, userId: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    try {
      await prisma.address.delete({ where: { id, userId } });
      return 'deleted';
    } catch (error) {
      if (isRecordNotFound(error)) {
        return 'not_found';
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return 'in_use';
      }
      throw error;
    }
  },
};

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
