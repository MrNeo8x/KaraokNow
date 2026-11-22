import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateSpecialDateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50) @Matches(/\S/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty({ example: '2030-01-01' }) @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @ApiProperty({ example: '2030-01-02' }) @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
}

export class UpdateSpecialDateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty({ example: '2030-01-01' }) @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @ApiProperty({ example: '2030-01-02' }) @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: string;
}
