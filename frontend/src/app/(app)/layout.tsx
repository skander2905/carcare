import { SiteHeader } from '@/components/layout/site-header';
import { RequireAuth } from '@/features/auth/require-auth';

/**
 * Everything in this route group is behind authentication. Putting the gate in
 * the layout means a new page added under `(app)/` is protected by existing,
 * rather than by the author remembering to wrap it.
 */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <RequireAuth>
      <SiteHeader />
      <main className="flex-1">{children}</main>
    </RequireAuth>
  );
}
