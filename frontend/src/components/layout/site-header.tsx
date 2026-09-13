import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

export function SiteHeader() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-50 w-full border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Gauge className="text-primary size-5" aria-hidden />
          <span>{env.appName}</span>
        </Link>

        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <a href={`${env.apiOrigin}/api/docs`} target="_blank" rel="noreferrer">
              API docs
            </a>
          </Button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
