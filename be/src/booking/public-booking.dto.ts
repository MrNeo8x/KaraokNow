import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { BOOKING_CODE_INPUT_PATTERN, normalizeBookingCode } from './booking-code';
import { IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreatePublicHoldDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() roomId!: string;
  @ApiProperty({ example: '2035-01-01T18:00:00+07:00' }) @IsDateString({ strict: true }) startAt!: string;
  @ApiProperty({ minimum: 1, maximum: 1440 }) @IsInt() @Min(1) @Max(1440) durationMinutes!: number;
  @ApiProperty({ example: '0912345678' }) @IsString() @Matches(/^\+?\d{8,15}$/) phone!: string;
  @ApiPropertyOptional({ maxLength: 254 }) @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiProperty({ example: '180000' }) @IsString() @Matches(/^(0|[1-9]\d{0,19})$/) expectedTotalAmountVnd!: string;
  @ApiProperty({ example: '1', description: 'Version returned by the public booking-terms endpoint' }) @IsString() @Matches(/^[1-9]\d*$/) termsVersion!: string;
}

export class PublicHoldResponseDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ format: 'date-time' }) reservedEndAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['HELD', 'EXPIRED', 'CONFIRMED'] }) status!: string;
  @ApiProperty() totalAmountVnd!: string;
  @ApiProperty() termsVersion!: string;
  @ApiProperty({ description: 'Deposit the merchant requires before staff can confirm (snapshotted at hold time); "0" when none is required. Paid in person; no online payment' }) depositRequiredVnd!: string;
  @ApiProperty({ minLength: 6, maxLength: 6, pattern: '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$', example: 'K7M4XQ', description: 'Booking code (PD-038): 6 characters, digits 2-9 and upper-case letters without I/O. Needed with the phone number for lookup; returned again only for a matching idempotent replay' }) bookingCode!: string;
}

export class PublicBookingLookupDto {
  @ApiProperty() @IsString() @Matches(/^\+?\d{8,15}$/) phone!: string;
  @ApiProperty({ minLength: 6, maxLength: 40, example: 'K7M4XQ', description: '6-character booking code (case-insensitive; spaces and hyphens ignored). Legacy 32-hex codes issued before PD-038 are still accepted' })
  @Transform(({ value }) => normalizeBookingCode(value)) @IsString() @Matches(BOOKING_CODE_INPUT_PATTERN, { message: 'bookingCode is invalid' }) bookingCode!: string;
}

export class PublicBookingStatusDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) bookingId!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], description: 'Booking status once staff confirmed the hold' }) bookingStatus!: string | null;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ enum: ['HELD', 'EXPIRED', 'CONFIRMED'] }) status!: string;
  @ApiProperty() totalAmountVnd!: string;
  @ApiProperty() termsVersion!: string;
  @ApiProperty({ description: 'Deposit required before confirmation; "0" when none is required' }) depositRequiredVnd!: string;
  @ApiProperty({ description: 'Deposit recorded by staff so far' }) depositRecordedVnd!: string;
}
