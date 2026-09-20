import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestApp, findCookie, httpServer, resetDatabase } from './test-app.js';

const COOKIE = 'carcare_refresh_token';
const PASSWORD = 'correct horse battery staple';

/**
 * The reuse-grace window, at a realistic setting.
 *
 * `auth.e2e-spec.ts` runs with the grace at zero so replay detection can be
 * tested without waiting. That configuration cannot see the failure mode this
 * file exists for: with no window, every spent token is judged a replay and the
 * question "is this family still alive?" never gets asked.
 */
describe('Refresh reuse grace (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ reuseGraceMs: 10_000 });
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => httpServer(app);

  /** Registers an account and returns its first refresh token. */
  async function startSession(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Sam Ben Ali' })
      .expect(201);

    return findCookie(response.headers, COOKIE)!.value;
  }

  const refresh = (token: string) =>
    request(server()).post('/api/v1/auth/refresh').set('Cookie', `${COOKIE}=${token}`);

  it('treats a just-rotated token as the same refresh while the session runs', async () => {
    const first = await startSession('racer@example.com');

    const rotated = await refresh(first).expect(200);
    const second = findCookie(rotated.headers, COOKIE)!.value;

    // The losing tab presents the spent token immediately afterwards.
    await refresh(first).expect(200);

    // ...and the winning tab's token is untouched: nobody is signed out.
    await refresh(second).expect(200);
  });

  it('does not let a just-spent token revive a logged-out session', async () => {
    const first = await startSession('leaver@example.com');

    const rotated = await refresh(first).expect(200);
    const second = findCookie(rotated.headers, COOKIE)!.value;

    await request(server()).post('/api/v1/auth/logout').set('Cookie', `${COOKIE}=${second}`).expect(204);

    // `first` was revoked by rotation a moment ago, so it is inside the grace
    // window — but the session it belonged to is over. Signing out on a shared
    // machine has to stay signed out.
    await refresh(first).expect(401);
    await refresh(second).expect(401);
  });

  it('honours an older spent token inside the window — the documented trade-off', async () => {
    const first = await startSession('slowtab@example.com');

    const second = findCookie((await refresh(first).expect(200)).headers, COOKIE)!.value;
    await refresh(second).expect(200);

    // `first` is two rotations old but still inside the window, and the server
    // cannot tell a slow tab from a thief that fast. ADR-010 accepts this: the
    // window is short precisely because it is the cost of not signing people
    // out for having two tabs open. Detection outside the window is covered in
    // auth.e2e-spec.ts, which runs with the grace set to zero.
    await refresh(first).expect(200);
  });
});
