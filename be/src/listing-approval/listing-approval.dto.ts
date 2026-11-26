import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class ListingQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'ALL'], default: 'PENDING', description: 'PENDING = published by merchant and not approved' })
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'ALL']) status?: 'PENDING' | 'APPROVED' | 'ALL';
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class ListingDecisionDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Reviewer note stored in the audit record' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RevokeListingDto {
  @ApiProperty({ minLength: 1, maxLength: 500, description: 'Reason stored in the audit record' })
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}

export class ListingResponseDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() merchantCode!: string;
  @ApiProperty() merchantName!: string;
  @ApiProperty() tenantStatus!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() platformApproved!: boolean;
  @ApiProperty({ nullable: true, format: 'uuid', type: String, description: 'Platform Admin who made the latest approve/revoke decision' }) platformDecidedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', type: String }) platformDecidedAt!: string | null;
  @ApiProperty({ description: 'Active branches that would become publicly visible' }) activeBranchCount!: number;
  @ApiProperty({ description: 'Public booking terms configured' }) termsConfigured!: boolean;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() version!: string;
}

export class ListingListDto {
  @ApiProperty({ type: [ListingResponseDto] }) items!: ListingResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
