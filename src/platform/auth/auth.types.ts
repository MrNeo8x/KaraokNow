import type { Request } from 'express';

export const ROLES = ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'] as const;
export type Role = typeof ROLES[number];

export interface Actor {
  userId: string;
  sessionId?: string;
  tenantId?: string;
  membershipId?: string;
  roles: Role[];
  branchIds: string[];
}

export interface AuthenticatedRequest extends Request {
  actor: Actor;
  correlationId: string;
}

export interface CorrelatedRequest extends Request { correlationId: string; actor?: Actor }
