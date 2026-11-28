import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CronJobsController } from './cron-jobs.controller';
import { CronSecretGuard } from './cron-secret.guard';

@Module({ imports: [BookingModule, OutboxModule], controllers: [CronJobsController], providers: [CronSecretGuard] })
export class JobsModule {}
