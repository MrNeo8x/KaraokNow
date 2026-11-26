import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CreatePublicHoldDto, PublicBookingLookupDto, PublicBookingStatusDto, PublicHoldResponseDto } from './public-booking.dto';
import { PublicBookingService } from './public-booking.service';

@ApiTags('public booking') @Controller('public/booking')
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  @Post('holds')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Visible ASCII 1–100 characters; scoped to published merchant and normalized phone (0…, 84…, +84… are the same number)' })
  @ApiResponse({ status: 201, type: PublicHoldResponseDto })
  @ApiResponse({ status: 409, description: 'Occupancy, price, terms version or idempotency conflict' })
  @ApiResponse({ status: 429, description: 'IP or phone rate limit exceeded' })
  create(@Req() req: Request, @Headers('idempotency-key') key: string, @Body() dto: CreatePublicHoldDto) {
    return this.booking.create(req.ip ?? req.socket.remoteAddress ?? 'unknown', key, dto);
  }

  @Post('lookup') @HttpCode(200)
  @ApiResponse({ status: 200, type: PublicBookingStatusDto })
  @ApiResponse({ status: 404, description: 'Generic response for an invalid phone/code pair' })
  @ApiResponse({ status: 429, description: 'IP or phone rate limit exceeded' })
  lookup(@Req() req: Request, @Body() dto: PublicBookingLookupDto) {
    return this.booking.lookup(req.ip ?? req.socket.remoteAddress ?? 'unknown', dto);
  }
}
