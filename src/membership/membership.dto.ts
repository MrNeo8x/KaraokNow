import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ROLES, Role } from '../platform/auth/auth.types';

export class CreateMembershipDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) displayName!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) temporaryPassword!: string;
  @ApiProperty({ enum: ROLES, isArray: true }) @IsArray() @ArrayNotEmpty() @IsEnum(ROLES, { each: true }) roles!: Role[];
  @ApiProperty({ type: [String], required: false }) @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) branchIds: string[] = [];
}

export class UpdateMembershipDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], required: false })
  @IsOptional() @IsEnum(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ enum: ROLES, isArray: true, required: false })
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsEnum(ROLES, { each: true }) roles?: Role[];
  @ApiProperty({ type: [String], required: false })
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) branchIds?: string[];
}
