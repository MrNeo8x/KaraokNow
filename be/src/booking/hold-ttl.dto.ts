import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateHoldTtlDto {
  @ApiProperty({ minimum: 1, maximum: 1440, example: 15 }) @IsInt() @Min(1) @Max(1440) ttlMinutes!: number;
}
