import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MembershipResponseDto } from './membership-response.dto';
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
  @ApiResponse({ status: 200, type: [MembershipResponseDto] })
  @Get() list(@Req() req: AuthenticatedRequest) { return this.memberships.list(req.actor.tenantId!); }
  @ApiResponse({ status: 201, type: MembershipResponseDto })
  @Post() create(@Req() req: AuthenticatedRequest, @Body() dto: CreateMembershipDto) {
    return this.memberships.create(req.actor, dto);
  }
  @ApiResponse({ status: 200, type: MembershipResponseDto })
  @Patch(':id') update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                       @Body() dto: UpdateMembershipDto) {
    return this.memberships.update(req.actor, id, dto);
  }
}
