import { Transform } from 'class-transformer';

/** Trimmed; an empty string means "not given" on create. */
export const trimmedOrAbsent = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
});

/** Trimmed; an empty string clears the field on update, exactly as null does. */
export const trimmedOrNull = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});
