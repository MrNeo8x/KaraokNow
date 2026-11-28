import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';
import { sendCsv } from './csv';
import {
  BookingReportDto, ChannelReportDto, MerchantReportQueryDto, OccupancyReportDto, PlatformMerchantReportDto, PlatformOverviewDto, ReportRangeQueryDto
} from './reports.dto';
import { ReportsService } from './reports.service';

const CSV = 'With format=csv the same rows are returned as text/csv (UTF-8 BOM)';

/** RPT-001 / PD-044: reports for the Owner (all branches) and Branch Managers (assigned branches). */
@ApiTags('reports') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @RequireRoles('OWNER', 'BRANCH_MANAGER')
@Controller('merchant/reports')
export class MerchantReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('bookings') @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ description: `Bookings by service date and money by recorded date, per period. ${CSV}` })
  @ApiResponse({ status: 200, type: BookingReportDto })
  @ApiResponse({ status: 403, description: 'Branch outside the caller scope' })
  @ApiResponse({ status: 422, description: 'Invalid range (max 366 days)' })
  async bookings(@Req() req: AuthenticatedRequest, @Query() query: MerchantReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.bookings(req.actor, query);
    if (query.format !== 'csv') return report;
    sendCsv(res, `bookings_${report.from}_${report.to}.csv`, report.rows, ['period', 'bookings', 'upcoming', 'completed', 'cancelled', 'noShow',
      'expectedRevenueVnd', 'depositsVnd', 'bookingCashVnd', 'reversalsVnd', 'refundsVnd', 'netCollectedVnd']);
  }

  @Get('occupancy') @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ description: `Room occupancy and peak start hours. ${CSV} (one row per room)` })
  @ApiResponse({ status: 200, type: OccupancyReportDto })
  async occupancy(@Req() req: AuthenticatedRequest, @Query() query: MerchantReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.occupancy(req.actor, query);
    if (query.format !== 'csv') return report;
    sendCsv(res, `occupancy_${report.from}_${report.to}.csv`, report.rooms, ['branchName', 'roomName', 'bookedMinutes', 'availableMinutes', 'occupancyRate']);
  }

  @Get('channels') @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ description: `Holds by channel and conversion to bookings. ${CSV}` })
  @ApiResponse({ status: 200, type: ChannelReportDto })
  async channels(@Req() req: AuthenticatedRequest, @Query() query: MerchantReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.channels(req.actor, query);
    if (query.format !== 'csv') return report;
    sendCsv(res, `channels_${report.from}_${report.to}.csv`, report.rows, ['channel', 'holds', 'confirmed', 'expired', 'conversionRate']);
  }
}

@ApiTags('reports') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/reports')
export class PlatformReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview') @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ description: `Platform growth and activity per period (Vietnam time) plus a current snapshot. ${CSV}` })
  @ApiResponse({ status: 200, type: PlatformOverviewDto })
  @ApiResponse({ status: 403, description: 'Caller is not a Platform Admin' })
  async overview(@Query() query: ReportRangeQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.platformOverview(query);
    if (query.format !== 'csv') return report;
    sendCsv(res, `platform_overview_${report.from}_${report.to}.csv`, report.rows, ['period', 'newMerchants', 'newBranches', 'newUsers', 'holds', 'bookingsConfirmed']);
  }

  @Get('merchants') @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ description: `Activity per merchant in the range (counts and money totals only). ${CSV}` })
  @ApiResponse({ status: 200, type: PlatformMerchantReportDto })
  async merchants(@Query() query: ReportRangeQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.platformMerchants(query);
    if (query.format !== 'csv') return report;
    sendCsv(res, `platform_merchants_${report.from}_${report.to}.csv`, report.rows, ['tenantName', 'tenantStatus', 'listingLive', 'branches', 'rooms',
      'holds', 'bookings', 'completed', 'cancelled', 'noShow', 'conversionRate', 'expectedRevenueVnd', 'netCollectedVnd']);
  }
}
