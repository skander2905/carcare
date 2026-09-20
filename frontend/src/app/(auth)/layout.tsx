import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { env } from '@/lib/env';

/**
 * A deliberately bare shell: no navigation, nothing to click away to. The only
 * job of these two screens is the form on them.
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Gauge className="text-primary size-5" aria-hidden />
          <span>{env.appName}</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
