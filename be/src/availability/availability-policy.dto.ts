import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UpdateAvailabilityPolicyDto {
  @ApiProperty({ default: true }) @IsBoolean() bufferEnabled!: boolean;
  @ApiProperty({ minimum: 0, maximum: 1440, default: 15 }) @IsInt() @Min(0) @Max(1440) bufferMinutes!: number;
}

export class AvailabilityPolicyResponseDto {
  @ApiProperty() bufferEnabled!: boolean;
  @ApiProperty({ description: 'Cleanup minutes added after each booking end (PD-024)' }) bufferMinutes!: number;
  @ApiProperty({ required: false, description: 'Absent until the merchant saves a value (defaults apply)' }) version?: string;
}
