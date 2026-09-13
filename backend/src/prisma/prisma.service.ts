import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseConfig } from '../config/configuration.js';
import { type DatabaseConfig } from '../config/config.types.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The application's single database handle.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled query
 * engine, so the connection string lives here (in validated configuration) and
 * never in `schema.prisma`.
 *
 * Extending `PrismaClient` keeps full model typing available to repositories
 * (`prisma.vehicle.findMany(...)`) while letting Nest own its lifecycle.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(databaseConfig.KEY) config: DatabaseConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Cheapest possible round-trip, used by the readiness probe. Deliberately not
   * a table read: this asks "can I reach the database", not "is the schema right".
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
