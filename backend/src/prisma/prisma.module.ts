import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global because practically every feature module needs database access, and
 * re-importing it in a dozen modules is noise rather than encapsulation.
 * Repositories are the only things that should actually inject it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
