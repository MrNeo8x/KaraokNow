import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { SuperAdminGuard } from './super-admin.guard';
import { SupportSessionController, SupportSessionService } from './support-sessions';

@Module({ imports: [AuthModule], controllers: [SupportSessionController], providers: [SupportSessionService, SuperAdminGuard] })
export class SupportSessionsModule {}
