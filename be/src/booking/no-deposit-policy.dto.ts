import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PolicyPageDto } from './policy-list.dto';

export class UpdateNoDepositPolicyDto {
  @ApiProperty({ description: 'Whether no-deposit confirmation is enabled for this merchant and channel' })
  @IsBoolean() allowed!: boolean;
}

export class NoDepositPolicyResponseDto {
  @ApiProperty() channel!: string;
  @ApiProperty() configured!: boolean;
  @ApiProperty({ nullable: true, type: Boolean, description: 'null when no merchant configuration exists' }) allowed!: boolean | null;
  @ApiPropertyOptional({ description: 'Configuration version; absent when unconfigured' }) version?: string;
}
export class NoDepositPolicyListDto extends PolicyPageDto {
  @ApiProperty({ type: [NoDepositPolicyResponseDto] }) items!: NoDepositPolicyResponseDto[];
}
