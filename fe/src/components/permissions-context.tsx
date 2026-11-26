'use client';

import { createContext, useContext } from 'react';
import type { Role } from '@/lib/admin';
import { can, type Permission } from '@/lib/permissions';

const RolesContext = createContext<readonly Role[] | null>(null);
export const RolesProvider = RolesContext.Provider;
export function useCan(): (permission: Permission) => boolean {
  const roles = useContext(RolesContext);
  return permission => can(roles, permission);
}
