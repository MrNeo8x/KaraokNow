import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRoomBlockDto {
  @ApiProperty() @IsUUID() roomId!: string;
  @ApiProperty() @IsISO8601({ strict: true }) startAt!: string;
  @ApiProperty() @IsISO8601({ strict: true }) endAt!: string;
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
}

export class UpdateRoomBlockDto {
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601({ strict: true }) endAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RoomBlockResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['ACTIVE', 'RELEASED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) endAt!: string;
}
