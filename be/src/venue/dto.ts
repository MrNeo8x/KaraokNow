import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) @IsString() @IsNotEmpty() @MaxLength(64) timezone!: string;
}

export class CreateRoomDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) capacity!: number;
}

export class UpdateBranchDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) timezone?: string;
}
export class BranchStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsEnum(['ACTIVE', 'INACTIVE']) status!: 'ACTIVE' | 'INACTIVE';
}
export class UpdateRoomDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(1000) capacity?: number;
}
export class RoomStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] })
  @IsEnum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status!: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
}

export class CreateRoomAmenityDto {
  @ApiProperty({ maxLength: 80, description: 'Free-form amenity label; no catalog is imposed' })
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(80) label!: string;
}

export class UpdateRoomAmenityDto {
  @ApiProperty({ maxLength: 80 })
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(80) label!: string;
}

export class CreateRoomMediaDto {
  @ApiProperty({ maxLength: 500, description: 'Opaque asset reference, not a URL; this API does not upload or fetch the asset' })
  @IsString() @IsNotEmpty() @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  @MaxLength(500) assetRef!: string;

  @ApiProperty({ required: false, maxLength: 200, description: 'Optional accessible text metadata' })
  @IsOptional() @IsString() @MaxLength(200) altText?: string;

  @ApiProperty({ required: false, minimum: 0, maximum: 10000, default: 0 })
  @IsOptional() @IsInt() @Min(0) @Max(10000) displayOrder?: number;
}

export class UpdateRoomMediaDto {
  @ApiProperty({ required: false, maxLength: 500, description: 'Opaque asset reference, not a URL; this API does not upload or fetch the asset' })
  @IsOptional() @IsString() @IsNotEmpty() @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  @MaxLength(500) assetRef?: string;

  @ApiProperty({ required: false, maxLength: 200, nullable: true, type: String, description: 'Pass null to clear this metadata' })
  @IsOptional() @IsString() @MaxLength(200) altText?: string | null;

  @ApiProperty({ required: false, minimum: 0, maximum: 10000 })
  @IsOptional() @IsInt() @Min(0) @Max(10000) displayOrder?: number;
}
