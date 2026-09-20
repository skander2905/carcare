import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OAuthProvider } from '../src/generated/prisma/enums.js';
import { ProviderRegistry } from '../src/auth/oauth/providers/provider.registry.js';
import {
  type AuthorizationRequest,
  type IdentityProvider,
  type ProviderIdentity,
} from '../src/auth/oauth/providers/oauth-provider.types.js';
import { createTestApp, findCookie, httpServer, resetDatabase } from './test-app.js';

const COOKIE = 'carcare_refresh_token';
const NONCE_COOKIE = 'carcare_oauth_nonce';
const PASSWORD = 'correct horse battery staple';

/**
 * Stands in for Google.
 *
 * The parts worth testing are ours: state issuing and single use, the linking
 * policy, user creation, the cookie handoff. Google's own token endpoint and
 * JWKS are Google's to get right, and reaching for them would make this suite
 * need credentials and an internet connection to say anything at all.
 */
class StubProvider implements IdentityProvider {
  readonly id = OAuthProvider.GOOGLE;
  readonly slug = 'google';
  readonly displayName = 'Google';

  /** Swapped per test to play a different person. */
  identity: ProviderIdentity = {
    providerAccountId: 'stub-sub-1',
    email: 'oauth-user@example.com',
    emailVerified: true,
    displayName: 'OAuth User',
  };

  lastCodeVerifier?: string;

  buildAuthorizationRequest(state: string): AuthorizationRequest {
    return { url: `https://provider.test/authorize?state=${state}`, codeVerifier: 'stub-verifier' };
  }

  exchangeCode(_code: string, codeVerifier: string): Promise<ProviderIdentity> {
    this.lastCodeVerifier = codeVerifier;
    return Promise.resolve(this.identity);
  }
}

describe('OAuth sign-in (e2e)', () => {
  let app: INestApplication;
  const provider = new StubProvider();

  beforeAll(async () => {
    app = await createTestApp({}, (builder) => {
      builder.overrideProvider(ProviderRegistry).useValue({
        list: () => [provider],
        require: (slug: string) => {
          if (slug !== provider.slug) throw new Error('Unknown sign-in provider');
          return provider;
        },
      });
    });
  });

  beforeEach(async () => {
    await resetDatabase(app);
    provider.identity = {
      providerAccountId: 'stub-sub-1',
      email: 'oauth-user@example.com',
      emailVerified: true,
      displayName: 'OAuth User',
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => httpServer(app);

  /**
   * Starts a flow, returning both halves of the binding: the `state` that goes
   * to the provider and the nonce cookie the browser keeps. A real browser
   * presents both on the callback, and the API now requires both.
   */
  async function beginFlow(returnTo?: string): Promise<{ state: string; nonce: string }> {
    const response = await request(server())
      .get('/api/v1/auth/oauth/google')
      .query(returnTo ? { returnTo } : {})
      .expect(302);

    return {
      state: new URL(response.headers.location).searchParams.get('state')!,
      nonce: findCookie(response.headers, NONCE_COOKIE)!.value,
    };
  }

  /** The callback as the browser that started the flow would make it. */
  const callback = ({ state, nonce }: { state: string; nonce: string }) =>
    request(server())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'stub-code', state })
      .set('Cookie', `${NONCE_COOKIE}=${nonce}`);

  describe('GET /auth/providers', () => {
    it('lists what this deployment can actually do', async () => {
      const response = await request(server()).get('/api/v1/auth/providers').expect(200);

      expect(response.body).toEqual([{ slug: 'google', displayName: 'Google' }]);
    });

    it('needs no authentication — the login page has to read it', async () => {
      await request(server()).get('/api/v1/auth/providers').expect(200);
    });
  });

  describe('starting a flow', () => {
    it('redirects to the provider with an unguessable state', async () => {
      const { state } = await beginFlow();

      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('issues a different state and nonce every time', async () => {
      const first = await beginFlow();
      const second = await beginFlow();

      expect(first.state).not.toBe(second.state);
      expect(first.nonce).not.toBe(second.nonce);
    });

    it('binds the flow to this browser with an httpOnly cookie', async () => {
      const response = await request(server()).get('/api/v1/auth/oauth/google').expect(302);
      const cookie = findCookie(response.headers, NONCE_COOKIE);

      // Script-readable would defeat the point: the whole purpose is that only
      // the browser that started the flow can finish it.
      expect(cookie?.attributes).toContain('HttpOnly');
      expect(cookie?.attributes).toContain('Path=/api/v1/auth');
    });
  });

  describe('the callback', () => {
    it('creates an account, sets the refresh cookie, and returns to the app', async () => {
      const response = await callback(await beginFlow()).expect(302);

      expect(response.headers.location).toBe('http://localhost:3000/dashboard');

      const cookie = findCookie(response.headers, COOKIE);
      expect(cookie?.attributes).toContain('HttpOnly');
      expect(cookie?.attributes).toContain('Path=/api/v1/auth');
    });

    it('never puts a token in the redirect URL', async () => {
      const response = await callback(await beginFlow()).expect(302);

      // The web app recovers its access token by calling /auth/refresh with the
      // cookie. A token in the query or fragment would land in browser history.
      expect(response.headers.location).not.toMatch(/token|jwt|ey[A-Za-z0-9]/);
    });

    it('hands over a session that actually works', async () => {
      const response = await callback(await beginFlow()).expect(302);
      const cookie = findCookie(response.headers, COOKIE)!.value;

      const refreshed = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${cookie}`)
        .expect(200);

      const me = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);

      expect(me.body).toMatchObject({ email: 'oauth-user@example.com', displayName: 'OAuth User' });
    });

    it('returns the same account on a second sign-in', async () => {
      const first = await callback(await beginFlow()).expect(302);
      const second = await callback(await beginFlow()).expect(302);

      const idOf = async (response: { headers: Record<string, unknown> }) => {
        const cookie = findCookie(response.headers, COOKIE)!.value;
        const { body } = await request(server())
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${cookie}`);
        const me = await request(server())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${body.accessToken}`);
        return me.body.id as string;
      };

      expect(await idOf(first)).toBe(await idOf(second));
    });

    it('honours a safe returnTo', async () => {
      const response = await callback(await beginFlow('/vehicles/123')).expect(302);

      expect(response.headers.location).toBe('http://localhost:3000/vehicles/123');
    });

    it('refuses to be redirected off-site', async () => {
      const response = await callback(await beginFlow('https://evil.example')).expect(302);

      expect(response.headers.location).toBe('http://localhost:3000/dashboard');
    });

    describe('state validation', () => {
      it('rejects a state that was never issued', async () => {
        const response = await callback({ state: 'forged-state', nonce: 'whatever' }).expect(302);

        expect(response.headers.location).toContain('error=oauth_state');
        expect(findCookie(response.headers, COOKIE)).toBeUndefined();
      });

      /**
       * Login CSRF. The attacker starts a flow for their own Google account and
       * sends the victim the resulting callback URL. The state is genuine and
       * unused — only the nonce cookie says whose browser began it, and the
       * victim's browser does not have it.
       */
      it('refuses a genuine callback URL replayed in another browser', async () => {
        const flow = await beginFlow();

        const response = await request(server())
          .get('/api/v1/auth/oauth/google/callback')
          .query({ code: 'stub-code', state: flow.state })
          .expect(302);

        expect(response.headers.location).toContain('error=oauth_state');
        // No session is issued, so nothing lands in the attacker's account.
        expect(findCookie(response.headers, COOKIE)).toBeUndefined();
      });

      it("refuses a callback carrying another flow's nonce", async () => {
        const mine = await beginFlow();
        const theirs = await beginFlow();

        const response = await callback({ state: mine.state, nonce: theirs.nonce }).expect(302);

        expect(response.headers.location).toContain('error=oauth_state');
      });

      it('clears the binding cookie once the flow is over', async () => {
        const response = await callback(await beginFlow()).expect(302);

        // It must not survive to be replayed against a later callback.
        expect(findCookie(response.headers, NONCE_COOKIE)?.attributes).toMatch(
          /Expires=Thu, 01 Jan 1970|Max-Age=0/,
        );
      });

      it('accepts a state exactly once', async () => {
        const flow = await beginFlow();
        await callback(flow).expect(302);

        // Replaying the callback URL — from browser history, or a proxy log —
        // must not mint a second session, even in the same browser.
        const replay = await callback(flow).expect(302);
        expect(replay.headers.location).toContain('error=oauth_state');
      });

      it('sends the user back to the login page when they cancel at the provider', async () => {
        const response = await request(server())
          .get('/api/v1/auth/oauth/google/callback')
          .query({ error: 'access_denied', state: 'whatever' })
          .expect(302);

        // Cancelling is not a failure worth an error message.
        expect(response.headers.location).toBe('http://localhost:3000/login');
      });
    });

    it('refuses to merge into an existing password account', async () => {
      await request(server())
        .post('/api/v1/auth/register')
        .send({ email: 'oauth-user@example.com', password: PASSWORD, displayName: 'Password Sam' })
        .expect(201);

      const response = await callback(await beginFlow()).expect(302);

      // The chosen policy: no silent merge, because this API cannot yet prove
      // the password account's address belongs to whoever registered it.
      expect(response.headers.location).toContain('error=oauth_email_taken');
      expect(findCookie(response.headers, COOKIE)).toBeUndefined();
    });
  });

  describe('connected accounts', () => {
    /** Signs in through the stub and returns a bearer token. */
    async function signIn(): Promise<string> {
      const response = await callback(await beginFlow()).expect(302);
      const cookie = findCookie(response.headers, COOKIE)!.value;

      const { body } = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${cookie}`)
        .expect(200);

      return body.accessToken as string;
    }

    it('lists the provider that created the account', async () => {
      const token = await signIn();

      const response = await request(server())
        .get('/api/v1/auth/oauth')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ provider: 'GOOGLE', email: 'oauth-user@example.com' });
    });

    it('requires authentication', async () => {
      await request(server()).get('/api/v1/auth/oauth').expect(401);
    });

    it('refuses to disconnect the only way into the account', async () => {
      const token = await signIn();

      // This account has no password — removing Google would lock the person
      // out permanently, since password reset needs email delivery we lack.
      const response = await request(server())
        .delete('/api/v1/auth/oauth/google')
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(response.body.message).toMatch(/only way to sign in/i);
    });

    it('rejects an unknown provider name', async () => {
      const token = await signIn();

      await request(server())
        .delete('/api/v1/auth/oauth/myspace')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });
});
