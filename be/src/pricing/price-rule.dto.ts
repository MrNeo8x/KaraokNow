import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PriceRuleValuesDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty({ minimum: -2147483648, maximum: 2147483647 }) @IsInt() @Min(-2147483648) @Max(2147483647) priority!: number;
  @ApiProperty({ enum: ['PER_HOUR', 'PER_BOOKING'] }) @IsIn(['PER_HOUR', 'PER_BOOKING']) amountUnit!: string;
  @ApiProperty({ example: '150000', description: 'Non-negative integer VND as a decimal string' }) @IsString() @Matches(/^(0|[1-9]\d{0,18})$/) amountVnd!: string;
  @ApiPropertyOptional({ type: [Number], example: [0, 6] }) @IsOptional() @IsArray() @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' }) @IsOptional() @IsUUID() roomId?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' }) @IsOptional() @IsUUID() specialDateId?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '18:00:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/) startTime?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '02:00:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/) endTime?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: 1440 }) @IsOptional() @IsInt() @Min(1) @Max(1440) minDurationMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: 1440 }) @IsOptional() @IsInt() @Min(1) @Max(1440) maxDurationMinutes?: number | null;
}

export class CreatePriceRuleDto extends PriceRuleValuesDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50) @Matches(/\S/) code!: string;
  @ApiProperty() @IsUUID() pricePlanId!: string;
}

export class UpdatePriceRuleDto extends PriceRuleValuesDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: string;
}
