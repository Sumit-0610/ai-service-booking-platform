import { repositories, type AddressRow } from '@aisbp/database';
import type { Address, CreateAddressInput, UpdateAddressInput } from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

function toDto(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
  };
}

/**
 * Every method is scoped to the authenticated user's id. There is no code path
 * that reads or writes an address without a matching `userId`, and a lookup that
 * does not match returns the same "not found" as a truly missing address, so a
 * customer cannot tell another customer's address apart from a non-existent one.
 */
export const addressService = {
  async list(userId: string): Promise<Address[]> {
    const rows = await repositories.addresses.listByUser(userId);
    return rows.map(toDto);
  },

  async get(userId: string, id: string): Promise<Address> {
    const row = await repositories.addresses.findByIdForUser(id, userId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Address not found');
    }
    return toDto(row);
  },

  async create(userId: string, input: CreateAddressInput): Promise<Address> {
    const row = await repositories.addresses.create(userId, input);
    return toDto(row);
  },

  async update(userId: string, id: string, input: UpdateAddressInput): Promise<Address> {
    const row = await repositories.addresses.updateForUser(id, userId, input);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Address not found');
    }
    return toDto(row);
  },

  async remove(userId: string, id: string): Promise<void> {
    const result = await repositories.addresses.deleteForUser(id, userId);
    if (result === 'not_found') {
      throw new AppError('NOT_FOUND', 'Address not found');
    }
    if (result === 'in_use') {
      throw new AppError(
        'CONFLICT',
        'This address is linked to a booking and can no longer be deleted.',
      );
    }
  },
};
