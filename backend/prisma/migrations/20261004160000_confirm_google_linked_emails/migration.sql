-- A password account that later connected Google, with the same address,
-- has proved it reads that address: Google only reports verified ones
-- (ADR-017). The previous migration only counted accounts created through
-- Google. From now on, signing in with or connecting Google does this itself.
UPDATE "users" u SET "emailVerifiedAt" = NOW()
WHERE u."emailVerifiedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "oauth_accounts" o
    WHERE o."userId" = u."id" AND lower(o."email") = u."email"
  );
