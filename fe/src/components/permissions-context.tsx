'use client';

import { createContext, useContext } from 'react';
import type { Role } from '@/lib/admin';
import { can, type Permission } from '@/lib/permissions';

const RolesContext = createContext<readonly Role[] | null>(null);
export const RolesProvider = RolesContext.Provider;
// Super Admin support session (PD-045): everything is visible but nothing may change.
const ReadOnlyContext = createContext(false);
export const ReadOnlyProvider = ReadOnlyContext.Provider;
export function useReadOnly(): boolean { return useContext(ReadOnlyContext); }
const READ_PERMISSIONS: ReadonlySet<Permission> = new Set(['cash.report', 'reports.view']);

export function useCan(): (permission: Permission) => boolean {
  const roles = useContext(RolesContext); const readOnly = useContext(ReadOnlyContext);
  return permission => (!readOnly || READ_PERMISSIONS.has(permission)) && can(roles, permission);
}
