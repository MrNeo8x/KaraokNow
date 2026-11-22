import { ForbiddenException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { VenueService } from './venue.service';

describe('VenueService authorization', () => {
  const query = jest.fn();
  const service = new VenueService({ query } as unknown as Pool);
  const manager: Actor = {
    userId: 'user-a', tenantId: 'tenant-a', membershipId: 'membership-a',
    roles: ['BRANCH_MANAGER'], branchIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
  };
  beforeEach(() => query.mockReset());

  it('scopes branch listing by tenant and assignments', async () => {
    query.mockResolvedValue({ rows: [] });
    await service.listBranches(manager);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tenant_id=$1'),
      ['tenant-a', false, manager.branchIds]);
  });

  it('rejects access to an unassigned branch before querying', async () => {
    await expect(service.createRoom(manager, {
      branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'VIP01', name: 'VIP 01', capacity: 12
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
});
