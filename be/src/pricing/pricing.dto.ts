import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, Max, Min } from 'class-validator';

export class QuoteRequestDto {
  @ApiProperty({ example: '2030-04-10T22:30:00+07:00', description: 'ISO-8601 timestamp with explicit offset' })
  @IsDateString({ strict: true }) startAt!: string;

  @ApiProperty({ minimum: 1, maximum: 1440, example: 120 })
  @IsInt() @Min(1) @Max(1440) durationMinutes!: number;
}

export class UpdateBookingDurationPolicyDto {
  @ApiProperty({ minimum: 1, maximum: 1440, example: 30 })
  @IsInt() @Min(1) @Max(1440) durationStepMinutes!: number;

  @ApiProperty({ minimum: 1, maximum: 1440, example: 60 })
  @IsInt() @Min(1) @Max(1440) minDurationMinutes!: number;

  @ApiProperty({ minimum: 1, maximum: 1440, example: 480 })
  @IsInt() @Min(1) @Max(1440) maxDurationMinutes!: number;
}
