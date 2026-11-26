import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PriceSnapshotDto } from '../pricing/quote-response.dto';

export class ConfirmHoldDto {
  @ApiProperty({ maxLength: 5000, description: 'Exact cancellation terms shown and agreed for this booking' })
  @IsString() @MinLength(1) @MaxLength(5000) @Matches(/\S/) cancellationTerms!: string;
}
class ConfirmationPolicySnapshotDto {
  @ApiProperty({ enum: ['NONE', 'FIXED', 'PERCENT'] }) depositMode!: string;
  @ApiProperty({ nullable: true, type: String }) depositPolicyVersion!: string | null;
  @ApiProperty({ description: 'True for the no-deposit path; false when a deposit was required and covered' }) noDepositAllowed!: boolean;
  @ApiProperty({ nullable: true, type: String }) noDepositPolicyVersion!: string | null;
  @ApiPropertyOptional({ description: 'Deposit-required path only' }) requiredDepositVnd?: string;
  @ApiPropertyOptional({ description: 'Deposit-required path only: hold deposits recorded at confirmation' }) depositRecordedVnd?: string;
}
export class BookingOutcomeDto {
  @ApiProperty({ enum: ['CUSTOMER_CANCELLED', 'MERCHANT_CANCELLED', 'NO_SHOW'] }) type!: string;
  @ApiProperty() note!: string;
  @ApiProperty({ description: 'CASH refund recorded by staff; "0" when none' }) refundAmountVnd!: string;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class RecordBookingOutcomeDto {
  @ApiProperty({ enum: ['CUSTOMER_CANCELLED', 'MERCHANT_CANCELLED', 'NO_SHOW'] })
  @IsIn(['CUSTOMER_CANCELLED', 'MERCHANT_CANCELLED', 'NO_SHOW']) type!: string;
  @ApiProperty({ maxLength: 1000, description: 'Staff review note, required (PD-015)' })
  @IsString() @MaxLength(1000) @Matches(/\S/) note!: string;
  @ApiPropertyOptional({ description: 'CASH refund already handed back, decimal VND; must not exceed recorded deposits plus payments. Staff decides; never computed', example: '0' })
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,18})$/) refundAmountVnd?: string;
}
export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() channel!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() bufferMinutes!: number;
  @ApiProperty({ format: 'date-time' }) reservedEndAt!: string;
  @ApiProperty() customerPhone!: string;
  @ApiProperty({ nullable: true, type: String }) customerEmail!: string | null;
  @ApiProperty({ format: 'date-time' }) phoneVerifiedAt!: string;
  @ApiProperty({ format: 'uuid' }) phoneVerifiedBy!: string;
  @ApiProperty({ type: PriceSnapshotDto }) priceSnapshot!: PriceSnapshotDto;
  @ApiProperty() cancellationTerms!: string;
  @ApiProperty({ type: ConfirmationPolicySnapshotDto }) confirmationPolicySnapshot!: ConfirmationPolicySnapshotDto;
  @ApiProperty({ enum: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) confirmedBy!: string;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time', type: String }) checkedInAt!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) checkedInBy!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', type: String, description: 'Actual end of use; may be before or after the scheduled end' }) checkedOutAt!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) checkedOutBy!: string | null;
  @ApiProperty({ nullable: true, type: BookingOutcomeDto, description: 'Staff-recorded cancellation/no-show outcome' }) outcome!: BookingOutcomeDto | null;
}
export class BookingListResponseDto {
  @ApiProperty({ type: [BookingResponseDto] }) items!: BookingResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
