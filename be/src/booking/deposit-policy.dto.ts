import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PolicyPageDto } from './policy-list.dto';

export class UpdateDepositPolicyDto {
  @ApiProperty({ enum: ['NONE', 'FIXED', 'PERCENT'] }) @IsIn(['NONE', 'FIXED', 'PERCENT']) mode!: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: '150000', description: 'VND integer string; required only for FIXED' })
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) fixedAmountVnd?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '25.0000', description: 'Percentage as decimal string with up to four fractional digits; required only for PERCENT' })
  @IsOptional() @IsString() @Matches(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/) percent?: string | null;
}

export class DepositPolicyResponseDto {
  @ApiProperty() channel!: string;
  @ApiProperty() configured!: boolean;
  @ApiProperty({ enum: ['NONE', 'FIXED', 'PERCENT'] }) mode!: string;
  @ApiProperty({ nullable: true, type: String }) fixedAmountVnd!: string | null;
  @ApiProperty({ nullable: true, type: String }) percent!: string | null;
  @ApiPropertyOptional() version?: string;
}

export class DepositPolicyListDto extends PolicyPageDto {
  @ApiProperty({ type: [DepositPolicyResponseDto] }) items!: DepositPolicyResponseDto[];
}
