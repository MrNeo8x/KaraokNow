import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpdatePublicationDto {
  @ApiProperty({ description: 'Request publication of all active branches and rooms; separate platform approval is required before they appear publicly' }) @IsBoolean() published!: boolean;
}
export class PublicationResponseDto {
  @ApiProperty() published!: boolean;
  @ApiProperty({ description: 'Separate platform approval; cannot be changed through the merchant API' }) platformApproved!: boolean;
  @ApiPropertyOptional() version?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], description: 'GET only. INACTIVE = suspended by Platform Admin (PD-031): hidden from customers and no new holds' }) tenantStatus?: string;
}
export class UpdatePublicBookingTermsDto {
  @ApiProperty({ maxLength: 5000, description: 'Single public cancellation/booking terms text shown before guest submission' })
  @IsString() @MaxLength(5000) @Matches(/\S/) terms!: string;
}
export class PublicBookingTermsResponseDto {
  @ApiProperty() configured!: boolean;
  @ApiProperty({ nullable: true, type: String }) terms!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Opaque version that must be submitted when accepting these terms' }) version!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) updatedAt?: string | null;
}
export class CatalogQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}
class CatalogPageDto {
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
export class PublicBranchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty() merchantName!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Public logo URL (PD-037); null when the merchant has none' }) merchantLogoUrl!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() timezone!: string;
}
export class PublicRoomDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() capacity!: number;
}
export class PublicBranchListDto extends CatalogPageDto { @ApiProperty({ type: [PublicBranchDto] }) items!: PublicBranchDto[]; }
export class PublicRoomListDto extends CatalogPageDto { @ApiProperty({ type: [PublicRoomDto] }) items!: PublicRoomDto[]; }
export class PublicAvailableRoomDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() capacity!: number;
}
export class PublicAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) requestedEndAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() bufferEnabled!: boolean;
  @ApiProperty() bufferMinutes!: number;
  @ApiProperty() appliedBufferMinutes!: number;
  @ApiProperty({ format: 'date-time' }) reservedEndAt!: string;
  @ApiProperty({ type: [PublicAvailableRoomDto] }) rooms!: PublicAvailableRoomDto[];
}
export class PublicBookingDurationPolicyDto {
  @ApiProperty() durationStepMinutes!: number;
  @ApiProperty() minDurationMinutes!: number;
  @ApiProperty() maxDurationMinutes!: number;
}
export class PublicQuoteResponseDto {
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) endAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
  @ApiProperty({ description: 'Final integer VND amount encoded as a decimal string' }) totalAmountVnd!: string;
  @ApiProperty({ type: PublicBookingDurationPolicyDto }) bookingDurationPolicy!: PublicBookingDurationPolicyDto;
}
