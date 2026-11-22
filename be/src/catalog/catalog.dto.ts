import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePublicationDto {
  @ApiProperty({ description: 'Request publication of all active branches and rooms; separate platform approval is required before they appear publicly' }) @IsBoolean() published!: boolean;
}
export class PublicationResponseDto {
  @ApiProperty() published!: boolean;
  @ApiProperty({ description: 'Separate platform approval; cannot be changed through the merchant API' }) platformApproved!: boolean;
  @ApiPropertyOptional() version?: string;
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
