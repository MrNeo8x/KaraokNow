import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(8) password!: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Optional when the browser sends the HttpOnly refresh cookie together with header `X-KN-Session: 1` (FE-012)' })
  @IsOptional() @IsString() @MinLength(32) refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8) currentPassword!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) newPassword!: string;
}

export class TokenPairResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' }) expiresIn!: number;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Refresh token lifetime in seconds' }) refreshExpiresIn!: number;
  @ApiProperty() mustChangePassword!: boolean;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time', type: String }) lastUsedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty() revoked!: boolean;
}
