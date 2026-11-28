import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { poolConfigFromEnv } from './pool-config';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [{
    provide: PG_POOL,
    useFactory: () => new Pool(poolConfigFromEnv(process.env))
  }],
  exports: [PG_POOL]
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
