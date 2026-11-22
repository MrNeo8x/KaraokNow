import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateHoldDto {
  @ApiProperty() @IsUUID() roomId!: string;
  @ApiProperty({ example: '2035-01-01T18:00:00+07:00' }) @IsDateString({ strict: true }) startAt!: string;
  @ApiProperty({ minimum: 1, maximum: 1440 }) @IsInt() @Min(1) @Max(1440) durationMinutes!: number;
  @ApiProperty({ example: 'WALK_IN' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,49}$/) channel!: string;
}

export class AttachHoldDetailsDto {
  @ApiProperty({ example: '0912345678', description: 'Phone number for manual verification; digits with optional leading +', maxLength: 16 })
  @IsString() @Matches(/^\+?\d{8,15}$/) phone!: string;
  @ApiPropertyOptional({ example: 'guest@example.com', maxLength: 254 }) @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiProperty({ example: '150000', description: 'Total VND shown by the quote API, as a decimal string' })
  @IsString() @Matches(/^(0|[1-9]\d{0,19})$/) expectedTotalAmountVnd!: string;
}

export class ListHoldsDto {
  @ApiProperty({ example: '2036-01-01T00:00:00+07:00', description: 'Start of search interval, inclusive, with explicit timezone' }) @IsDateString({ strict: true }) from!: string;
  @ApiProperty({ example: '2036-01-02T00:00:00+07:00', description: 'End of search interval, exclusive, with explicit timezone' }) @IsDateString({ strict: true }) to!: string;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}
