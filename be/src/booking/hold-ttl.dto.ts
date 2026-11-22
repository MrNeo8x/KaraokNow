import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { PolicyPageDto } from './policy-list.dto';

export class UpdateHoldTtlDto {
  @ApiProperty({ minimum: 1, maximum: 1440, example: 15 }) @IsInt() @Min(1) @Max(1440) ttlMinutes!: number;
}
export class HoldTtlResponseDto {
  @ApiProperty() channel!: string;
  @ApiProperty() ttlMinutes!: number;
  @ApiPropertyOptional() version?: string;
}
export class HoldTtlListDto extends PolicyPageDto {
  @ApiProperty({ type: [HoldTtlResponseDto] }) items!: HoldTtlResponseDto[];
}
