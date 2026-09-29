import { type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * A one-tap option. Rendered as a real button with `aria-pressed`, so a
 * screen reader announces which choice is on, and big enough to hit on a phone
 * standing at a pump.
 */
export function ChoiceChip({
  selected = false,
  className,
  ...props
}: ComponentProps<'button'> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
        'focus-visible:ring-ring/50 focus-visible:ring-3 outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-muted border-input',
        className,
      )}
      {...props}
    />
  );
}
