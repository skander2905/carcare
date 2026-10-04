import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/features/account-email/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  // `useSearchParams` (for the token) needs a boundary, as on the sign-in page.
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
