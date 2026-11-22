import { ApiProperty } from '@nestjs/swagger';

export class AvailableRoomResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() capacity!: number;
}
export class AvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty({ format: 'date-time' }) requestedEndAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() bufferEnabled!: boolean;
  @ApiProperty() bufferMinutes!: number;
  @ApiProperty() appliedBufferMinutes!: number;
  @ApiProperty({ format: 'date-time' }) reservedEndAt!: string;
  @ApiProperty({ type: [AvailableRoomResponseDto] }) rooms!: AvailableRoomResponseDto[];
}
