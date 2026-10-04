import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailResult } from '@/features/account-email/verify-email-result';

export const metadata: Metadata = { title: 'Confirm email' };

export default function Page() {
  // `useSearchParams` (for the token) needs a boundary, as on the sign-in page.
  return (
    <Suspense fallback={null}>
      <VerifyEmailResult />
    </Suspense>
  );
}
