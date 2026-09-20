import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { type User } from '../prisma/model.types.js';
import { type UpdateProfileDto } from './dto/update-profile.dto.js';
import { type CreateUserData, UsersRepository } from './users.repository.js';

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  /**
   * Relies on the unique index rather than a "does this email exist?" check
   * first. Two simultaneous registrations for the same address would both pass
   * such a check and one would then fail anyway — so the constraint is the
   * authority and the race simply cannot happen.
   */
  async create(data: CreateUserData): Promise<User> {
    try {
      return await this.users.create(data);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        throw new ConflictException('An account with that email address already exists');
      }
      throw error;
    }
  }

  async updateProfile(id: string, changes: UpdateProfileDto): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');

    // An empty PATCH is a no-op, not an error: re-saving an unchanged form
    // should not fail.
    if (Object.keys(changes).length === 0) return user;

    return this.users.update(id, changes);
  }
}
