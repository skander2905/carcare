import { BadRequestException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '../../common/validation/uuid.js';
import {
  type GuardedRequest,
  VehicleMembershipGuard,
} from '../../vehicles/guards/vehicle-membership.guard.js';
import { VehicleMemberRepository } from '../../vehicles/vehicle-member.repository.js';
import { DocumentsRepository } from '../documents.repository.js';

/**
 * Guards `/documents/:id`: resolves the document to its vehicle, then applies
 * the same membership check as every vehicle route. A missing document and
 * someone else's answer the same 404 — see ExpenseAccessGuard.
 */
@Injectable()
export class DocumentAccessGuard extends VehicleMembershipGuard {
  protected readonly notFoundMessage = 'Document not found';

  constructor(
    reflector: Reflector,
    members: VehicleMemberRepository,
    private readonly documents: DocumentsRepository,
  ) {
    super(reflector, members);
  }

  protected async resolveVehicleId(request: GuardedRequest): Promise<string | undefined> {
    const id = request.params.id;
    if (typeof id !== 'string' || id.length === 0) return undefined;

    if (!isUuid(id)) throw new BadRequestException('id must be a UUID');

    return (await this.documents.vehicleIdOf(id)) ?? undefined;
  }
}
