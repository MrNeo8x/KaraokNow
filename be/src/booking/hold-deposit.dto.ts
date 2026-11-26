import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class DepositPolicySnapshotDto {
  @ApiProperty({ enum: ['NONE', 'FIXED', 'PERCENT'] }) mode!: string;
  @ApiProperty({ nullable: true, type: String }) fixedAmountVnd!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '30.0000' }) percent!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Channel deposit-policy version at snapshot time; null when the channel was unconfigured (NONE default)' }) policyVersion!: string | null;
  @ApiProperty({ description: 'Required deposit for the snapshotted quote total. FIXED is capped at the total; PERCENT rounds up to whole VND' }) requiredAmountVnd!: string;
}

export class RecordHoldDepositDto {
  @ApiProperty({ enum: ['CASH'] }) @IsIn(['CASH']) method!: string;
  @ApiProperty({ description: 'Positive integer VND as a decimal string; must not exceed the remaining required deposit', example: '50000' })
  @IsString() @Matches(/^[1-9]\d{0,18}$/) amountVnd!: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class HoldDepositEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ enum: ['CASH'] }) method!: string;
  @ApiProperty() amountVnd!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class HoldDepositStatusDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ enum: ['HELD', 'EXPIRED', 'CONFIRMED'] }) holdStatus!: string;
  @ApiProperty({ nullable: true, type: DepositPolicySnapshotDto, description: 'Null until customer details and the price snapshot are recorded' }) depositPolicySnapshot!: DepositPolicySnapshotDto | null;
  @ApiProperty() requiredAmountVnd!: string;
  @ApiProperty() totalRecordedVnd!: string;
  @ApiProperty() remainingVnd!: string;
  @ApiProperty({ description: 'True when the snapshot requires a deposit and the recorded total covers it' }) depositSatisfied!: boolean;
  @ApiProperty({ type: [HoldDepositEntryDto] }) items!: HoldDepositEntryDto[];
}
