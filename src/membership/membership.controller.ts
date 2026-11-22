import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CreateMembershipDto, UpdateMembershipDto } from './membership.dto';
import { MembershipService } from './membership.service';

@ApiTags('memberships') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @RequireRoles('OWNER')
@Controller('merchant/memberships')
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}
  @Get() list(@Req() req: AuthenticatedRequest) { return this.memberships.list(req.actor.tenantId!); }
  @Post() create(@Req() req: AuthenticatedRequest, @Body() dto: CreateMembershipDto) {
    return this.memberships.create(req.actor, dto);
  }
  @Patch(':id') update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                       @Body() dto: UpdateMembershipDto) {
    return this.memberships.update(req.actor, id, dto);
  }
}
