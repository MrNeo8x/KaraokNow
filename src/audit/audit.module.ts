import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({ imports: [AuthModule], controllers: [AuditController], providers: [AuditService, TenantGuard] })
export class AuditModule {}
