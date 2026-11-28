import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';
import { MembershipResponseDto } from '../membership/membership-response.dto';
import {
  PlatformBranchDto, PlatformCreateMembershipDto, PlatformReasonDto, PlatformUpdateMembershipDto, PlatformUserDto, PlatformUserListDto,
  PlatformUserQueryDto, TemporaryPasswordDto
} from './platform-users.dto';
import { PlatformUsersService } from './platform-users.service';

const SELF = 'Not a Platform Admin, or the action targets the caller\'s own account';

@ApiTags('platform users') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get()
  @ApiResponse({ status: 200, type: PlatformUserListDto })
  @ApiResponse({ status: 403, description: 'Caller is not a Platform Admin' })
  list(@Query() query: PlatformUserQueryDto) { return this.users.list(query); }

  @Get(':id')
  @ApiResponse({ status: 200, type: PlatformUserDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  get(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }

  @Post(':id/disable') @HttpCode(200)
  @ApiOperation({ description: 'Disables the account everywhere and revokes all its sessions immediately. Idempotent' })
  @ApiResponse({ status: 200, type: PlatformUserDto })
  @ApiResponse({ status: 403, description: SELF })
  disable(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformReasonDto) {
    return this.users.setStatus(req.actor, id, 'DISABLED', dto.reason);
  }

  @Post(':id/enable') @HttpCode(200)
  @ApiResponse({ status: 200, type: PlatformUserDto })
  @ApiResponse({ status: 403, description: SELF })
  enable(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformReasonDto) {
    return this.users.setStatus(req.actor, id, 'ACTIVE', dto.reason);
  }

  @Post(':id/temporary-password') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ description: 'Support path for forgotten passwords (PD-014/PD-040): returns a temporary password once, forces a change at next login, revokes all sessions and clears the login lock' })
  @ApiResponse({ status: 200, type: TemporaryPasswordDto })
  @ApiResponse({ status: 403, description: SELF })
  @ApiResponse({ status: 409, description: 'User is disabled' })
  temporaryPassword(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformReasonDto) {
    return this.users.issueTemporaryPassword(req.actor, id, dto.reason);
  }

  @Post(':id/platform-admin') @HttpCode(200)
  @ApiResponse({ status: 200, type: PlatformUserDto, description: 'Platform Admin granted. Idempotent' })
  @ApiResponse({ status: 409, description: 'User is disabled' })
  grantAdmin(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformReasonDto) {
    return this.users.setPlatformAdmin(req.actor, id, true, dto.reason);
  }

  @Post(':id/platform-admin/revoke') @HttpCode(200)
  @ApiResponse({ status: 200, type: PlatformUserDto, description: 'Platform Admin revoked. Idempotent' })
  @ApiResponse({ status: 403, description: SELF })
  @ApiResponse({ status: 409, description: 'Would leave no active Platform Admin' })
  revokeAdmin(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformReasonDto) {
    return this.users.setPlatformAdmin(req.actor, id, false, dto.reason);
  }
}

@ApiTags('platform users') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/merchants/:tenantId')
export class PlatformMembershipsController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get('memberships')
  @ApiResponse({ status: 200, type: [MembershipResponseDto] })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) { return this.users.listMemberships(tenantId); }

  @Get('branches')
  @ApiResponse({ status: 200, type: [PlatformBranchDto], description: 'Branches to choose from when granting branch-scoped roles' })
  branches(@Param('tenantId', ParseUUIDPipe) tenantId: string) { return this.users.branches(tenantId); }

  @Post('memberships')
  @ApiOperation({ description: 'Adds a member (creates the user with the temporary password when the email is new). Audited in the merchant and platform logs' })
  @ApiResponse({ status: 201, type: MembershipResponseDto })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or the admin belongs to the merchant' })
  @ApiResponse({ status: 409, description: 'Already a member' })
  create(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: PlatformCreateMembershipDto) {
    return this.users.createMembership(req.actor, tenantId, dto);
  }

  @Patch('memberships/:membershipId')
  @ApiOperation({ description: 'Changes roles, branches or status of a member. The merchant must keep at least one active Owner' })
  @ApiResponse({ status: 200, type: MembershipResponseDto })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or the admin belongs to the merchant' })
  @ApiResponse({ status: 409, description: 'Would leave the merchant without an active Owner' })
  update(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string,
         @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: PlatformUpdateMembershipDto) {
    return this.users.updateMembership(req.actor, tenantId, membershipId, dto);
  }
}
