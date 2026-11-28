import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../platform/auth/auth.types';

export class MembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ enum: ROLES, isArray: true }) roles!: string[];
  @ApiProperty({ type: [String], description: 'Granted branch UUIDs' }) branchIds!: string[];
}
