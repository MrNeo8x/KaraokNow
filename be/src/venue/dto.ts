import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) @IsString() @IsNotEmpty() @MaxLength(64) timezone!: string;
  @ApiProperty({ required: false, nullable: true, type: String, maxLength: 300, description: 'One-line address shown to customers (PD-042); null clears it' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/\S/) @MaxLength(300) address?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, example: '0989 015 619', description: 'Public contact phone (PD-042), stored as +84…; null clears it' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^\+?[0-9][0-9 .()-]{7,19}$/) phone?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, maxLength: 500, description: 'Google Maps link (full or maps.app.goo.gl) or "latitude, longitude"; null clears the location' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) mapsLink?: string | null;
}

export class ResolveLocationDto {
  @ApiProperty({ maxLength: 500 }) @IsString() @IsNotEmpty() @MaxLength(500) mapsLink!: string;
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
  @ApiProperty({ required: false, nullable: true, type: String, maxLength: 300, description: 'One-line address shown to customers (PD-042); null clears it' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/\S/) @MaxLength(300) address?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, example: '0989 015 619', description: 'Public contact phone (PD-042), stored as +84…; null clears it' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^\+?[0-9][0-9 .()-]{7,19}$/) phone?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, maxLength: 500, description: 'Google Maps link (full or maps.app.goo.gl) or "latitude, longitude"; null clears the location' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) mapsLink?: string | null;
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
