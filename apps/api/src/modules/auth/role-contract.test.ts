import { Role as DatabaseRole } from '@aisbp/database';
import { roleSchema } from '@aisbp/shared';
import { describe, expect, it } from 'vitest';

describe('role contract', () => {
  it('the shared role enum matches the database Role enum', () => {
    expect([...roleSchema.options].sort()).toEqual(Object.values(DatabaseRole).sort());
  });
});
