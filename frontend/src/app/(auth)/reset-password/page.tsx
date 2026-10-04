import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/account-email/reset-password-form';

export const metadata: Metadata = { title: 'New password' };

export default function Page() {
  // `useSearchParams` (for the token) needs a boundary, as on the sign-in page.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
