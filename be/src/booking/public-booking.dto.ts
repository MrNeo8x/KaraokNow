import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: '128-bit lookup code. Store securely; returned again only for matching idempotent replay.' }) bookingCode!: string;
}

export class PublicBookingLookupDto {
  @ApiProperty() @IsString() @Matches(/^\+?\d{8,15}$/) phone!: string;
  @ApiProperty({ minLength: 32, maxLength: 32 }) @IsString() @Matches(/^[a-f0-9]{32}$/) bookingCode!: string;
}

export class PublicBookingStatusDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) bookingId!: string | null;
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
