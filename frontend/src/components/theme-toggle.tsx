'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

/**
 * Both icons are always rendered and swapped purely by the `dark:` variant.
 *
 * That avoids the usual `mounted` flag: the server cannot know the resolved
 * theme, so branching on it in JSX would hydrate differently than it rendered.
 * Letting CSS react to the `dark` class that next-themes puts on <html> keeps
 * the markup identical on both sides.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change colour theme">
          <Sun
            className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
            aria-hidden
          />
          <Moon
            className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
