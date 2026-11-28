import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRangeQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'First local date (inclusive), YYYY-MM-DD' }) @Matches(DATE) from!: string;
  @ApiProperty({ example: '2026-11-30', description: 'Last local date (inclusive); at most 366 days after from' }) @Matches(DATE) to!: string;
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day', description: 'Period size (weeks start on Monday)' })
  @IsOptional() @IsIn(['day', 'week', 'month']) groupBy?: 'day' | 'week' | 'month';
  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json', description: 'csv returns text/csv (UTF-8 with BOM) for spreadsheets' })
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

export class MerchantReportQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'One branch; omitted = every branch the caller can see' }) @IsOptional() @IsUUID() branchId?: string;
}

export class BookingReportRowDto {
  @ApiProperty({ example: '2026-11-01', description: 'Period start date' }) period!: string;
  @ApiProperty({ description: 'Bookings whose start falls in the period (service date)' }) bookings!: number;
  @ApiProperty() upcoming!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty() noShow!: number;
  @ApiProperty({ description: 'Price + net surcharges of bookings not cancelled/no-show, by service date' }) expectedRevenueVnd!: string;
  @ApiProperty({ description: 'Deposits recorded in the period (by recorded date, same as the cash report)' }) depositsVnd!: string;
  @ApiProperty() bookingCashVnd!: string;
  @ApiProperty({ description: 'Reversed deposits and cash payments' }) reversalsVnd!: string;
  @ApiProperty() refundsVnd!: string;
  @ApiProperty({ description: 'deposits + cash − reversals − refunds' }) netCollectedVnd!: string;
}
export class BookingReportDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ enum: ['day', 'week', 'month'] }) groupBy!: string;
  @ApiProperty({ type: [String], description: 'Branches included' }) branchIds!: string[];
  @ApiProperty({ type: BookingReportRowDto }) totals!: BookingReportRowDto;
  @ApiProperty({ type: [BookingReportRowDto] }) rows!: BookingReportRowDto[];
}

export class RoomOccupancyDto {
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty() branchName!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() roomName!: string;
  @ApiProperty({ description: 'Minutes of confirmed/checked-in/completed bookings starting in the range (buffer excluded)' }) bookedMinutes!: number;
  @ApiProperty({ description: 'Days × daily opening minutes (1440 when the branch has no opening hours)' }) availableMinutes!: number;
  @ApiProperty({ description: 'bookedMinutes / availableMinutes, 0–1 (4 decimals)' }) occupancyRate!: number;
}
export class PeakHourDto {
  @ApiProperty({ description: 'ISO weekday, 1 = Monday … 7 = Sunday' }) weekday!: number;
  @ApiProperty({ description: 'Local start hour 0–23' }) hour!: number;
  @ApiProperty() bookings!: number;
}
export class OccupancyReportDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [String] }) branchIds!: string[];
  @ApiProperty() bookedMinutes!: number;
  @ApiProperty() availableMinutes!: number;
  @ApiProperty() occupancyRate!: number;
  @ApiProperty({ type: [RoomOccupancyDto] }) rooms!: RoomOccupancyDto[];
  @ApiProperty({ type: [PeakHourDto], description: 'Only cells with at least one booking' }) peakHours!: PeakHourDto[];
}

export class ChannelRowDto {
  @ApiProperty({ example: 'WEB' }) channel!: string;
  @ApiProperty({ description: 'Holds created in the range (by created date)' }) holds!: number;
  @ApiProperty({ description: 'Of those, holds that became bookings' }) confirmed!: number;
  @ApiProperty({ description: 'Of those, holds that expired without a booking' }) expired!: number;
  @ApiProperty({ description: 'confirmed / holds, 0–1 (4 decimals)' }) conversionRate!: number;
}
export class ChannelReportDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [String] }) branchIds!: string[];
  @ApiProperty({ type: ChannelRowDto, description: 'All channels together (channel = "ALL")' }) totals!: ChannelRowDto;
  @ApiProperty({ type: [ChannelRowDto] }) rows!: ChannelRowDto[];
}

export class PlatformOverviewRowDto {
  @ApiProperty() period!: string;
  @ApiProperty() newMerchants!: number;
  @ApiProperty() newBranches!: number;
  @ApiProperty() newUsers!: number;
  @ApiProperty() holds!: number;
  @ApiProperty({ description: 'Bookings confirmed in the period (by confirmation date)' }) bookingsConfirmed!: number;
}
export class PlatformSnapshotDto {
  @ApiProperty() merchantsActive!: number;
  @ApiProperty() merchantsSuspended!: number;
  @ApiProperty({ description: 'Published listings waiting for Platform approval' }) listingsPendingApproval!: number;
  @ApiProperty({ description: 'Listings visible to customers' }) listingsLive!: number;
  @ApiProperty({ description: 'Merchants with at least one booking confirmed in the range' }) merchantsWithBookings!: number;
  @ApiProperty() activeUsers!: number;
}
export class PlatformOverviewDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ enum: ['day', 'week', 'month'] }) groupBy!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) timezone!: string;
  @ApiProperty({ type: PlatformSnapshotDto }) snapshot!: PlatformSnapshotDto;
  @ApiProperty({ type: PlatformOverviewRowDto }) totals!: PlatformOverviewRowDto;
  @ApiProperty({ type: [PlatformOverviewRowDto] }) rows!: PlatformOverviewRowDto[];
}

export class PlatformMerchantRowDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) tenantStatus!: string;
  @ApiProperty() listingLive!: boolean;
  @ApiProperty() branches!: number;
  @ApiProperty() rooms!: number;
  @ApiProperty() holds!: number;
  @ApiProperty() bookings!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty() noShow!: number;
  @ApiProperty() conversionRate!: number;
  @ApiProperty() expectedRevenueVnd!: string;
  @ApiProperty() netCollectedVnd!: string;
}
export class PlatformMerchantReportDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [PlatformMerchantRowDto] }) rows!: PlatformMerchantRowDto[];
}
