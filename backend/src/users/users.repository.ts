import { Injectable } from '@nestjs/common';
import { type User } from '../prisma/model.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface UpdateUserData {
  displayName?: string;
  currency?: string;
  locale?: string;
  timezone?: string;
}

/**
 * All `User` table access, and nothing else. No business rules live here — the
 * service decides what a duplicate email means, this only reports what the
 * database did.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Callers must pass an already-normalised address. The column stores the
   * lower-cased form, so an unnormalised lookup would miss.
   */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: UpdateUserData): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
}
