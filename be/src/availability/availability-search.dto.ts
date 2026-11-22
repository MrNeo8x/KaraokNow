import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, Max, Min } from 'class-validator';

export class AvailabilitySearchDto {
  @ApiProperty({ example: '2030-05-10T11:00:00+07:00', description: 'ISO-8601 timestamp with explicit offset' })
  @IsDateString({ strict: true }) startAt!: string;

  @ApiProperty({ minimum: 1, maximum: 1440, example: 60 })
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) durationMinutes!: number;
}
