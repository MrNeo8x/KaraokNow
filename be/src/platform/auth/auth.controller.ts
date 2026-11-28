import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { AuthGuard } from './auth.guard';
import { AuthService, REFRESH_TTL_SECONDS } from './auth.service';
import { clearRefreshCookie, refreshTokenFrom, setRefreshCookie } from './refresh-cookie';
import { ChangePasswordDto, LoginDto, RefreshTokenDto, TokenPairResponseDto, SessionResponseDto } from './auth.dto';
import { AllowDuringPasswordChange } from './password-change.decorator';

@ApiTags('authentication') @Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @HttpCode(HttpStatus.OK) @ApiResponse({ status: 200, type: TokenPairResponseDto })
  @ApiOperation({ description: 'Also sets the HttpOnly refresh cookie `kn_refresh` (path /v1/auth, SameSite=Strict) so the browser keeps the session across reloads (FE-012)' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const pair = await this.auth.login(dto);
    setRefreshCookie(res, pair.refreshToken, REFRESH_TTL_SECONDS);
    return pair;
  }
  @Post('refresh') @HttpCode(HttpStatus.OK) @ApiResponse({ status: 200, type: TokenPairResponseDto })
  @ApiOperation({ description: 'Rotates the refresh token from the body, or from the `kn_refresh` cookie when header `X-KN-Session: 1` is sent. Cookie mode only: a token rotated in the last 10 s by a concurrent request (another tab) gets a sibling session instead of revoking the family; body tokens keep strict reuse detection' })
  @ApiHeader({ name: 'X-KN-Session', required: false, description: 'Send `1` to use the refresh cookie instead of a body token' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, expired or reused token; reuse revokes the family' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      // The concurrent-refresh grace applies only to the shared browser cookie (several tabs), not to body tokens.
      const pair = await this.auth.refresh(refreshTokenFrom(req, dto.refreshToken, true)!, !dto.refreshToken);
      setRefreshCookie(res, pair.refreshToken, REFRESH_TTL_SECONDS);
      return pair;
    } catch (error) {
      if (error instanceof UnauthorizedException) clearRefreshCookie(res); // keep the cookie on transient 409/503
      throw error;
    }
  }
  @Post('logout') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ description: 'Revokes the refresh-token family (body token, or the cookie with `X-KN-Session: 1`), including any token rotated concurrently, and clears the cookie. Unknown or missing tokens still return 204.' })
  @ApiHeader({ name: 'X-KN-Session', required: false })
  @ApiResponse({ status: 204, description: 'Logout processed' })
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = refreshTokenFrom(req, dto.refreshToken, false);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
  }

  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @Post('password/change') @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.actor.userId, dto);
  }
  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @ApiResponse({ status: 200, type: [SessionResponseDto] })
  @Get('sessions') listSessions(@Req() req: AuthenticatedRequest) { return this.auth.listSessions(req.actor.userId); }
  @ApiBearerAuth() @UseGuards(AuthGuard) @AllowDuringPasswordChange()
  @Delete('sessions/:id') @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(req.actor.userId, id);
  }
}
