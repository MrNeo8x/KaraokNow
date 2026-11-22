import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(8) password!: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() @MinLength(32) refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8) currentPassword!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) newPassword!: string;
}
