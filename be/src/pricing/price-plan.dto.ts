import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreatePricePlanDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50) @Matches(/\S/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date', example: '2030-01-01' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date', example: '2030-12-31' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string | null;
}

export class UpdatePricePlanDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'INACTIVE'] }) @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE']) status!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date', example: '2030-01-01' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date', example: '2030-12-31' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string | null;
}
