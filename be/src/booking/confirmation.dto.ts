import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PriceSnapshotDto } from '../pricing/quote-response.dto';

export class ConfirmHoldDto {
  @ApiProperty({ maxLength: 5000, description: 'Exact cancellation terms shown and agreed for this booking' })
  @IsString() @MinLength(1) @MaxLength(5000) @Matches(/\S/) cancellationTerms!: string;
}
class ConfirmationPolicySnapshotDto {
  @ApiProperty({ enum: ['NONE'] }) depositMode!: string;
  @ApiProperty({ nullable: true, type: String }) depositPolicyVersion!: string | null;
  @ApiProperty({ enum: [true] }) noDepositAllowed!: boolean;
  @ApiProperty() noDepositPolicyVersion!: string;
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
  @ApiProperty({ enum: ['CONFIRMED'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) confirmedBy!: string;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
}
export class BookingListResponseDto {
  @ApiProperty({ type: [BookingResponseDto] }) items!: BookingResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}
