import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type IdempotencyKey } from '../../prisma/model.types.js';

const UNIQUE_VIOLATION = 'P2002';

/** Printable ASCII, no spaces. Long enough for a UUID or a ULID with a prefix. */
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

export interface IdempotentRequest {
  userId: string;
  key: string;
  /** The operation, e.g. `expense.create`. */
  scope: string;
  requestHash: string;
}

/**
 * Makes a `POST` safe to retry, as api.md §8 describes.
 *
 * The key is written in the same transaction as the resource it created, under
 * a unique `(userId, key)` index. That is what makes it correct under
 * concurrency rather than merely likely to work: two requests racing with the
 * same key cannot both commit, and the loser finds the winner's row and replays
 * it. A check-then-insert without the constraint would let both through.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validates the header value; `undefined` means the client sent none. */
  parseKey(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;

    if (!KEY_PATTERN.test(raw)) {
      throw new BadRequestException('Idempotency-Key must be 1–255 printable characters with no spaces');
    }

    return raw;
  }

  /**
   * A fingerprint of what the request asks for — the operation, its target and
   * its body — so a reused key can be told apart from a genuine retry.
   *
   * Keys are sorted before hashing: two retries of one request may serialise
   * their fields in a different order, and must still match.
   */
  fingerprint(scope: string, target: string, body: object): string {
    return createHash('sha256')
      .update(`${scope}\n${target}\n${stableStringify(body)}`)
      .digest('hex');
  }

  find(userId: string, key: string): Promise<IdempotencyKey | null> {
    return this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  }

  remember(
    tx: Prisma.TransactionClient,
    request: IdempotentRequest,
    resourceId: string,
  ): Promise<IdempotencyKey> {
    return tx.idempotencyKey.create({ data: { ...request, resourceId } });
  }

  /**
   * The resource id a spent key refers to, if it was spent on this same request.
   *
   * A key reused for a *different* request is a client bug — typically a key
   * generated once per form rather than once per submission. Replaying the old
   * result would tell the client its new request succeeded when it never ran,
   * so it is refused instead.
   */
  replayedResourceId(existing: IdempotencyKey, request: IdempotentRequest): string {
    if (existing.scope !== request.scope || existing.requestHash !== request.requestHash) {
      throw new UnprocessableEntityException(
        'This Idempotency-Key was already used for a different request. Generate a new key for each submission.',
      );
    }

    return existing.resourceId;
  }

  /**
   * Whether an error is the key's own unique index refusing a concurrent twin.
   *
   * Checked by code alone: the only unique constraint an idempotent create
   * touches is the key's, and the caller confirms by finding the winning row
   * before treating it as a replay.
   */
  isConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}
