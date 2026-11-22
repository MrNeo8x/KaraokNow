import { SetMetadata } from '@nestjs/common';
import type { Role } from './auth.types';

export const REQUIRED_ROLES = 'required_roles';
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
