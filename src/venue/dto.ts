import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
