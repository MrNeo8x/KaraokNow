import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ROLES } from '../platform/auth/auth.types';
import { CreateMembershipDto, UpdateMembershipDto } from '../membership/membership.dto';

export class PlatformUserQueryDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Case-insensitive match on email or display name' })
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED', 'ALL'], default: 'ALL' }) @IsOptional() @IsIn(['ACTIVE', 'DISABLED', 'ALL']) status?: 'ACTIVE' | 'DISABLED' | 'ALL';
  @ApiPropertyOptional({ description: 'true = only Platform Admins' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : value) @IsBoolean() platformAdmin?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class PlatformUserMembershipDto {
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) tenantStatus!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ enum: ROLES, isArray: true }) roles!: string[];
  @ApiProperty({ type: [String] }) branchIds!: string[];
}

export class PlatformUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: string;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty() platformAdmin!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) lastLoginAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) disabledAt!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Reason given when the account was disabled' }) disabledReason!: string | null;
  @ApiProperty({ type: [PlatformUserMembershipDto] }) memberships!: PlatformUserMembershipDto[];
}

export class PlatformUserListDto {
  @ApiProperty({ type: [PlatformUserDto] }) items!: PlatformUserDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}

export class PlatformReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 500, description: 'Justification stored in the platform audit record' })
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class TemporaryPasswordDto {
  @ApiProperty({ description: 'Shown once. The user must change it at next login; all their sessions were revoked' }) temporaryPassword!: string;
  @ApiProperty({ type: PlatformUserDto }) user!: PlatformUserDto;
}

export class PlatformCreateMembershipDto extends CreateMembershipDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class PlatformUpdateMembershipDto extends UpdateMembershipDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class PlatformBranchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}
