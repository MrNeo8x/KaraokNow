import type { Role } from './admin';

/** Mirrors backend @RequireRoles (be/src, 2026-11-26). UI gating only; the backend still enforces every call. */
const MATRIX = {
  'hold.create': ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST'],
  'hold.manage': ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST'], // customer details, phone verification, confirmation
  'deposit.record': ['OWNER', 'BRANCH_MANAGER', 'CASHIER'],
  'booking.checkInOut': ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST'],
  'booking.outcome': ['OWNER', 'BRANCH_MANAGER'],
  'cash.access': ['OWNER', 'BRANCH_MANAGER', 'CASHIER'],
  'policy.update': ['OWNER', 'BRANCH_MANAGER'], // overtime grace, hold TTL, deposit and no-deposit channel policies
  'surcharge.record': ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'], // PD-036
  'money.reverse': ['OWNER', 'BRANCH_MANAGER'], // full reversal of a deposit, CASH payment or surcharge
  'cash.report': ['OWNER', 'BRANCH_MANAGER', 'CASHIER'], // daily cash report and unresolved expired-hold deposits
  'deposit.resolve': ['OWNER', 'BRANCH_MANAGER'], // record refund/retention of an expired hold's deposit
  'venue.manage': ['OWNER', 'BRANCH_MANAGER'], // rooms, amenities and room photos
  'reports.view': ['OWNER', 'BRANCH_MANAGER'], // RPT-001 booking/revenue, occupancy and channel reports (PD-044)
  'owner.admin': ['OWNER'], // memberships, publication, public terms, audit, ops backlog, price plans
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof MATRIX;

/** `roles === null` means unknown (still loading or /me failed): allow and let the backend decide. */
export function can(roles: readonly Role[] | null, permission: Permission): boolean {
  return roles === null || roles.some(role => (MATRIX[permission] as readonly Role[]).includes(role));
}
