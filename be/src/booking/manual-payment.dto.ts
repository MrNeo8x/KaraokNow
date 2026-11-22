import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RecordManualPaymentDto {
  @ApiProperty({ enum: ['CASH'] }) @IsIn(['CASH']) method!: string;
  @ApiProperty({ description: 'Positive integer VND as a decimal string', example: '150000' }) @IsString() @Matches(/^[1-9]\d{0,18}$/) amountVnd!: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ManualPaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ enum: ['CASH'] }) method!: string;
  @ApiProperty() amountVnd!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class ManualPaymentListDto {
  @ApiProperty({ type: [ManualPaymentResponseDto] }) items!: ManualPaymentResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
