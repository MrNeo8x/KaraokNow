import { ApiProperty } from '@nestjs/swagger';

export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh', description: 'IANA timezone' }) timezone!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Normalised +84… contact phone' }) phone!: string | null;
  @ApiProperty({ nullable: true, type: Number }) latitude!: number | null;
  @ApiProperty({ nullable: true, type: Number }) longitude!: number | null;
  @ApiProperty({ nullable: true, type: String, description: 'Link the Owner pasted' }) mapsUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Google Maps directions to the coordinates' }) directionsUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '09:00', description: 'Opening time HH:mm; null = open 24 h (PD-043)' }) openingTime!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '02:00', description: 'Closing time HH:mm; ≤ openingTime means after midnight' }) closingTime!: string | null;
}

export class ResolvedLocationDto {
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty({ nullable: true, type: String }) mapsUrl!: string | null;
  @ApiProperty() directionsUrl!: string;
}

export class RoomResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}

export class RoomAmenityResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class RoomMediaResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ description: 'Storage reference only; binary upload/fetch is out of scope' }) assetRef!: string;
  @ApiProperty({ nullable: true, type: String }) altText!: string | null;
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ nullable: true, type: String, description: 'Public URL of an uploaded photo (PD-037); null for metadata-only entries' }) url!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] }) contentType!: string | null;
  @ApiProperty({ nullable: true, type: Number }) sizeBytes!: number | null;
}

export class UploadRoomMediaDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, at most 4 MB; compress on the client (PD-037)' }) file!: unknown;
  @ApiProperty({ required: false, maxLength: 200 }) altText?: string;
  @ApiProperty({ required: false, minimum: 0, maximum: 10000, description: 'Defaults to the number of existing media entries' }) displayOrder?: number;
}
