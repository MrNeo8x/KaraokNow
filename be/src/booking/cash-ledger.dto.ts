import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const MONEY = /^[1-9]\d{0,18}$/;
const MONEY_OR_ZERO = /^(0|[1-9]\d{0,18})$/;

export class AddSurchargeDto {
  @ApiProperty({ description: 'Positive integer VND as a decimal string', example: '50000' }) @IsString() @Matches(MONEY) amountVnd!: string;
  @ApiProperty({ maxLength: 500, description: 'What the surcharge is for (drinks, service…), required' }) @IsString() @MaxLength(500) @Matches(/\S/) reason!: string;
}

export class SurchargeResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty() amountVnd!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export const REVERSIBLE_ENTRY_TYPES = ['HOLD_DEPOSIT', 'MANUAL_PAYMENT', 'SURCHARGE'] as const;

export class CreateReversalDto {
  @ApiProperty({ enum: REVERSIBLE_ENTRY_TYPES }) @IsIn(REVERSIBLE_ENTRY_TYPES) entryType!: (typeof REVERSIBLE_ENTRY_TYPES)[number];
  @ApiProperty({ format: 'uuid', description: 'ID of the hold deposit, manual payment or surcharge being reversed' }) @IsUUID() entryId!: string;
  @ApiProperty({ maxLength: 500, description: 'Why the original entry is wrong; required' }) @IsString() @MaxLength(500) @Matches(/\S/) reason!: string;
}

export class ReversalResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ enum: REVERSIBLE_ENTRY_TYPES }) entryType!: string;
  @ApiProperty({ format: 'uuid' }) entryId!: string;
  @ApiProperty({ description: 'Full amount of the reversed entry' }) amountVnd!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class LedgerEntryDto {
  @ApiProperty({ enum: ['DEPOSIT', 'CASH', 'SURCHARGE', 'REVERSAL', 'REFUND'] }) kind!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Always positive; the kind tells whether it adds to due, adds to paid or subtracts' }) amountVnd!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Payment note, surcharge/reversal reason or outcome note' }) note!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: REVERSIBLE_ENTRY_TYPES, description: 'REVERSAL only: type of the reversed entry' }) reversesType!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid', description: 'REVERSAL only: ID of the reversed entry' }) reversesId!: string | null;
  @ApiProperty({ description: 'True for DEPOSIT/CASH/SURCHARGE entries that have been reversed' }) reversed!: boolean;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class BookingAccountDto {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] }) bookingStatus!: string;
  @ApiProperty({ description: 'Total from the price snapshot' }) priceTotalVnd!: string;
  @ApiProperty({ description: 'Surcharges net of reversals' }) surchargesVnd!: string;
  @ApiProperty({ description: 'priceTotalVnd + surchargesVnd; 0 for CANCELLED/NO_SHOW (PD-036)' }) dueVnd!: string;
  @ApiProperty({ description: 'Hold deposits net of reversals' }) depositsVnd!: string;
  @ApiProperty({ description: 'Booking CASH payments net of reversals' }) cashVnd!: string;
  @ApiProperty({ description: 'Refund recorded with the cancellation/no-show outcome' }) refundsVnd!: string;
  @ApiProperty({ description: 'depositsVnd + cashVnd − refundsVnd' }) paidVnd!: string;
  @ApiProperty({ description: 'dueVnd − paidVnd; negative means collected more than due' }) balanceVnd!: string;
  @ApiProperty({ enum: ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'CLOSED'], description: 'CLOSED for CANCELLED/NO_SHOW' }) settlement!: string;
  @ApiProperty({ nullable: true, type: String, description: 'CANCELLED/NO_SHOW only: amount the merchant keeps (= paidVnd)' }) retainedVnd!: string | null;
  @ApiProperty({ type: [LedgerEntryDto] }) entries!: LedgerEntryDto[];
}

export class ResolveDepositDto {
  @ApiProperty({ description: 'CASH handed back, integer VND (0 = keep everything); at most the net deposit', example: '0' }) @IsString() @Matches(MONEY_OR_ZERO) refundAmountVnd!: string;
  @ApiProperty({ maxLength: 500, description: 'Why the deposit was refunded or kept; required' }) @IsString() @MaxLength(500) @Matches(/\S/) reason!: string;
}

export class DepositResolutionDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ description: 'Net deposit on the hold when resolved' }) netDepositVnd!: string;
  @ApiProperty() refundAmountVnd!: string;
  @ApiProperty({ description: 'netDepositVnd − refundAmountVnd' }) retainedVnd!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class UnresolvedDepositDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() channel!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ nullable: true, type: String }) customerPhone!: string | null;
  @ApiProperty() netDepositVnd!: string;
}

export class UnresolvedDepositListDto {
  @ApiProperty({ type: [UnresolvedDepositDto] }) items!: UnresolvedDepositDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class CashReportQueryDto {
  @ApiProperty({ example: '2026-11-28', description: 'Local date in the branch timezone' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
}

export class CashTotalsDto {
  @ApiProperty({ description: 'Hold deposits recorded' }) depositsVnd!: string;
  @ApiProperty({ description: 'Booking CASH recorded' }) bookingCashVnd!: string;
  @ApiProperty({ description: 'Reversals of deposits and CASH recorded (reduce cash)' }) cashReversalsVnd!: string;
  @ApiProperty({ description: 'Cancellation/no-show refunds plus expired-hold deposit refunds' }) refundsVnd!: string;
  @ApiProperty({ description: 'depositsVnd + bookingCashVnd − cashReversalsVnd − refundsVnd: expected change in the till' }) netCashVnd!: string;
  @ApiProperty({ description: 'Surcharges added net of surcharge reversals (amount due, not cash)' }) surchargesVnd!: string;
}

export class CashRecorderTotalsDto extends CashTotalsDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() displayName!: string;
}

export class CashReportDto {
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ format: 'date-time', description: 'Inclusive start of the local day' }) from!: string;
  @ApiProperty({ format: 'date-time', description: 'Exclusive end of the local day' }) to!: string;
  @ApiProperty({ type: CashTotalsDto }) totals!: CashTotalsDto;
  @ApiProperty({ type: [CashRecorderTotalsDto], description: 'Same totals per staff member who recorded the entries' }) byRecorder!: CashRecorderTotalsDto[];
}
