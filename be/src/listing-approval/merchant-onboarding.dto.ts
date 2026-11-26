import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class MerchantOwnerInputDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) @Matches(/\S/) displayName!: string;
  @ApiProperty({ minLength: 12, description: 'Used only when the email has no account yet; the owner must change it at first login. Share it out of band' })
  @IsString() @MinLength(12) @MaxLength(200) temporaryPassword!: string;
}

export class CreateMerchantDto {
  @ApiProperty({ example: 'KARAOKE_HCM', description: 'Unique merchant code: uppercase letters, digits, "_" or "-"' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,49}$/) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty({ type: MerchantOwnerInputDto }) @IsDefined() @ValidateNested() @Type(() => MerchantOwnerInputDto) owner!: MerchantOwnerInputDto;
}

export class MerchantQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'], default: 'ALL' }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class MerchantOwnerDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ description: 'False when the email already had an account; the supplied temporary password was not applied' }) accountCreated!: boolean;
}

export class MerchantSummaryDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ description: 'Active memberships holding the OWNER role' }) ownerCount!: number;
  @ApiProperty() activeBranchCount!: number;
  @ApiProperty() published!: boolean;
  @ApiProperty() platformApproved!: boolean;
}

export class CreatedMerchantDto extends MerchantSummaryDto {
  @ApiProperty({ type: MerchantOwnerDto }) owner!: MerchantOwnerDto;
}

export class MerchantListDto {
  @ApiProperty({ type: [MerchantSummaryDto] }) items!: MerchantSummaryDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
