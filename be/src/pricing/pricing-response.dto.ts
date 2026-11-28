import { ApiProperty } from '@nestjs/swagger';

export class PricePlanResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) effectiveFrom!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) effectiveTo!: string | null;
  @ApiProperty({ description: 'Optimistic version as decimal string' }) version!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class PriceRuleResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) pricePlanId!: string;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) specialDateId!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) roomId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Higher wins; ties are rejected at quote time' }) priority!: number;
  @ApiProperty({ type: [Number], description: '0 = Sunday … 6 = Saturday; empty = every day' }) weekdays!: number[];
  @ApiProperty({ nullable: true, type: String, example: '18:00:00' }) startTime!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '23:00:00' }) endTime!: string | null;
  @ApiProperty({ nullable: true, type: Number }) minDurationMinutes!: number | null;
  @ApiProperty({ nullable: true, type: Number }) maxDurationMinutes!: number | null;
  @ApiProperty({ description: 'Integer VND as decimal string' }) amountVnd!: string;
  @ApiProperty({ nullable: true, type: String, enum: ['PER_HOUR', 'PER_BOOKING'] }) amountUnit!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty() version!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SpecialDateResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
