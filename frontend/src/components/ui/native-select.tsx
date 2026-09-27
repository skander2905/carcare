import * as React from 'react';
import { cn } from 'cn';

/**
 * A styled native `<select>`.
 *
 * Native rather than a custom listbox: the platform picker is what phones are
 * good at, keyboard and screen-reader support come for free, and none of these
 * lists is long enough to need search.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
