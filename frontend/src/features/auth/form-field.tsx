import { type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FormFieldProps extends ComponentProps<typeof Input> {
  label: string;
  /** Validation message for this field, if any. */
  error?: string;
  hint?: string;
}

/**
 * A labelled input that stays accessible when it is invalid.
 *
 * `aria-invalid` plus `aria-describedby` are what make a screen reader announce
 * the error at all — a red border communicates nothing to someone who cannot
 * see it, and nothing to someone who is colour-blind either.
 */
export function FormField({ label, error, hint, id, ...props }: FormFieldProps) {
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={Boolean(error)} aria-describedby={messageId} {...props} />

      {error ? (
        <p id={messageId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
