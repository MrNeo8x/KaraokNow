import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AuditService } from './audit.service';

@ApiTags('audit') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @RequireRoles('OWNER')
@Controller('merchant/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  list(@Req() req: AuthenticatedRequest,
       @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
       @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number) {
    return this.audit.list(req.actor.tenantId!, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }
}
