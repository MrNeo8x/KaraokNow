import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from './auth.types';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './auth.dto';
import { AllowDuringPasswordChange } from './password-change.decorator';

@ApiTags('authentication') @Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @HttpCode(HttpStatus.OK) login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post('refresh') @HttpCode(HttpStatus.OK) refresh(@Body() dto: RefreshTokenDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('logout') @HttpCode(HttpStatus.NO_CONTENT) logout(@Body() dto: RefreshTokenDto) { return this.auth.logout(dto.refreshToken); }

  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @Post('password/change') @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.actor.userId, dto);
  }
  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @Get('sessions') listSessions(@Req() req: AuthenticatedRequest) { return this.auth.listSessions(req.actor.userId); }
  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @Delete('sessions/:id') @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(req.actor.userId, id);
  }
}
