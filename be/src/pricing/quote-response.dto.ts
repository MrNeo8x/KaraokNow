import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BookingDurationPolicyResponseDto {
  @ApiProperty() durationStepMinutes!: number;
  @ApiProperty() minDurationMinutes!: number;
  @ApiProperty() maxDurationMinutes!: number;
  @ApiPropertyOptional({ description: 'Present when a policy has been persisted' }) version?: string;
}
export class QuoteLocalStartDto {
  @ApiProperty({ example: '2030-04-10' }) date!: string;
  @ApiProperty({ example: '22:30:00' }) time!: string;
  @ApiProperty({ minimum: 0, maximum: 6, description: 'Sunday=0 through Saturday=6' }) weekday!: number;
}
export class QuoteSpecialDateDto {
  @ApiProperty() code!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
}
export class QuoteCalculationDto {
  @ApiProperty({ format: 'uuid' }) pricePlanId!: string;
  @ApiProperty() pricePlanCode!: string;
  @ApiProperty() pricePlanVersion!: string;
  @ApiProperty({ format: 'uuid' }) priceRuleId!: string;
  @ApiProperty() priceRuleCode!: string;
  @ApiProperty() priceRuleVersion!: string;
  @ApiProperty() priority!: number;
  @ApiProperty({ enum: ['PER_HOUR', 'PER_BOOKING'] }) amountUnit!: string;
  @ApiProperty({ description: 'Configured integer VND, encoded as a decimal string' }) configuredAmountVnd!: string;
  @ApiProperty({ type: QuoteLocalStartDto }) matchedOnLocalStart!: QuoteLocalStartDto;
  @ApiProperty({ type: QuoteSpecialDateDto, nullable: true }) specialDate!: QuoteSpecialDateDto | null;
  @ApiProperty({ example: 'nearest 1 VND, half up' }) rounding!: string;
}
export class PriceSnapshotDto {
  @ApiProperty({ example: 1 }) schemaVersion!: number;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) timezone!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) endAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
  @ApiProperty({ description: 'Final amount as an integer VND decimal string' }) totalAmountVnd!: string;
  @ApiProperty({ type: QuoteCalculationDto }) calculation!: QuoteCalculationDto;
  @ApiProperty({ type: BookingDurationPolicyResponseDto }) bookingDurationPolicy!: BookingDurationPolicyResponseDto;
}
export class QuoteResponseDto {
  @ApiProperty({ type: PriceSnapshotDto }) priceSnapshot!: PriceSnapshotDto;
}
