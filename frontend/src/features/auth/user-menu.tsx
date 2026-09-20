'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Car, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from './use-auth';

/** "Sam Ben Ali" → "SB". Falls back to the address when there is no name. */
function initials(name: string, email: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (letters || email[0] || '?').toUpperCase();
}

export function UserMenu() {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // The session is recovered asynchronously on every cold load, so rendering
  // "Sign in" first and swapping it for an avatar a moment later would flicker
  // on every single page view.
  if (status === 'loading') return <Skeleton className="size-8 rounded-full" />;

  if (status === 'unauthenticated' || !user) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/register">Get started</Link>
        </Button>
      </>
    );
  }

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      router.replace('/');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            <AvatarFallback>{initials(user.displayName, user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="text-sm font-medium">{user.displayName}</p>
          {/* Wraps rather than overflows: addresses get long. */}
          <p className="text-muted-foreground break-all text-xs">{user.email}</p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard className="size-4" aria-hidden />
            Dashboard
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/vehicles">
            <Car className="size-4" aria-hidden />
            Vehicles
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={signingOut}
          // Radix closes the menu on select; `onSelect` firing an async call
          // directly would unmount the item mid-request.
          onSelect={(event) => {
            event.preventDefault();
            void onSignOut();
          }}
        >
          <LogOut className="size-4" aria-hidden />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
