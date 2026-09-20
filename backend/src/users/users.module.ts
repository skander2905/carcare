import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  // AuthModule needs the service; the repository stays private so no other
  // module can reach past the rules into the table.
  exports: [UsersService],
})
export class UsersModule {}
