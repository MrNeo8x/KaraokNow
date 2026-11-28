import { ApiProperty } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, format: 'uuid', type: String, description: 'Null for system actions (workers, public requests)' }) actorUserId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true, description: 'Structure depends on action; never contains customer PII or free-text notes' }) beforeData!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true }) afterData!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}
