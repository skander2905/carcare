import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UnsubscribeConfirm } from '@/features/account-email/unsubscribe-confirm';

export const metadata: Metadata = { title: 'Stop emails' };

export default function Page() {
  // `useSearchParams` (for the token) needs a boundary, as on the sign-in page.
  return (
    <Suspense fallback={null}>
      <UnsubscribeConfirm />
    </Suspense>
  );
}
