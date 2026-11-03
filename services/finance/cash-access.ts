import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { db } from '../../packages/platform/db.js';

// Ownership is immutable, but must be checked even when idempotency returns a cached result.
export async function assertCashierAccess(tenant: string, site: string, shiftId: string, actor: string, role: string) {
  const shift = (await db.query(
    'SELECT cashier_id FROM shifts WHERE tenant_id=$1 AND site_id=$2 AND id=$3',
    [tenant, site, shiftId],
  )).rows[0];
  if (!shift) throw new NotFoundException('Không tìm thấy ca.');
  if (role === 'CASHIER' && shift.cashier_id !== actor)
    throw new ForbiddenException('Ca này do người khác mở.');
}
