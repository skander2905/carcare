import { type ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleRole } from '../../generated/prisma/enums.js';
import { type VehicleMemberRepository } from '../vehicle-member.repository.js';
import { VehicleAccessGuard } from './vehicle-access.guard.js';

const VEHICLE_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

function buildContext(params: Record<string, string>, user: { id: string } | undefined = { id: 'user-1' }) {
  const request: Record<string, unknown> = { params, user };

  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('VehicleAccessGuard', () => {
  let reflector: Reflector;
  let members: { findFor: ReturnType<typeof vi.fn> };
  let guard: VehicleAccessGuard;

  const requiring = (role: VehicleRole | undefined) => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(role);
  };

  beforeEach(() => {
    reflector = new Reflector();
    members = { findFor: vi.fn() };
    guard = new VehicleAccessGuard(reflector, members as unknown as VehicleMemberRepository);
    requiring(undefined);
  });

  it('resolves membership and attaches it to the request', async () => {
    members.findFor.mockResolvedValue({ role: VehicleRole.OWNER });
    const { context, request } = buildContext({ id: VEHICLE_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    // Handlers scope their queries by this, never by the raw parameter.
    expect(request.vehicleAccess).toEqual({ vehicleId: VEHICLE_ID, role: VehicleRole.OWNER });
    expect(members.findFor).toHaveBeenCalledWith(VEHICLE_ID, 'user-1');
  });

  it('reads :vehicleId on nested collections', async () => {
    members.findFor.mockResolvedValue({ role: VehicleRole.VIEWER });
    const { context } = buildContext({ vehicleId: VEHICLE_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(members.findFor).toHaveBeenCalledWith(VEHICLE_ID, 'user-1');
  });

  /**
   * The rule that keeps identifiers from being enumerable: to someone with no
   * membership, another person's vehicle and a vehicle that never existed must
   * look identical.
   */
  it('answers 404, never 403, when there is no membership', async () => {
    members.findFor.mockResolvedValue(null);
    const { context } = buildContext({ id: VEHICLE_ID });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a malformed id before it reaches the database', async () => {
    const { context } = buildContext({ id: 'not-a-uuid' });

    // Guards run before pipes, so a ParseUUIDPipe on the parameter never gets
    // the chance — the id would reach Prisma, fail its uuid cast, and surface
    // as a 500 instead of a clean rejection.
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 400 });
    expect(members.findFor).not.toHaveBeenCalled();
  });

  it('answers 404 when the route names no vehicle at all', async () => {
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(members.findFor).not.toHaveBeenCalled();
  });

  describe('role requirements', () => {
    it('lets any member through when no role is demanded', async () => {
      members.findFor.mockResolvedValue({ role: VehicleRole.VIEWER });
      const { context } = buildContext({ id: VEHICLE_ID });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('refuses a viewer on an editor route', async () => {
      requiring(VehicleRole.EDITOR);
      members.findFor.mockResolvedValue({ role: VehicleRole.VIEWER });
      const { context } = buildContext({ id: VEHICLE_ID });

      // 403 is safe here and 404 would be wrong: they can already see this
      // vehicle, so its existence is not a secret. What they lack is permission.
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts a higher role than demanded', async () => {
      requiring(VehicleRole.EDITOR);
      members.findFor.mockResolvedValue({ role: VehicleRole.OWNER });
      const { context } = buildContext({ id: VEHICLE_ID });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('refuses an editor on an owner-only route', async () => {
      // Deleting a vehicle destroys its whole cost history, so a shared editor
      // must not be able to do it.
      requiring(VehicleRole.OWNER);
      members.findFor.mockResolvedValue({ role: VehicleRole.EDITOR });
      const { context } = buildContext({ id: VEHICLE_ID });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('never consults Vehicle.ownerId', async () => {
    // ADR-006: ownership says who bought the car, membership says who may reach
    // it. If this guard ever grew an ownerId shortcut, sharing would silently
    // stop working and this test is what would catch it.
    members.findFor.mockResolvedValue({ role: VehicleRole.VIEWER });
    const { context } = buildContext({ id: VEHICLE_ID });

    await guard.canActivate(context);

    expect(members.findFor).toHaveBeenCalledTimes(1);
  });
});
