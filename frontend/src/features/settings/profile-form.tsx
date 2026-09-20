'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/features/auth/form-field';
import { useAuth } from '@/features/auth/use-auth';
import { api, ApiError } from '@/lib/api/client';
import { type AuthUser } from '@/lib/auth/types';

/** Mirrors `UpdateProfileDto`; the API validates these again regardless. */
const CURRENCIES = ['TND', 'EUR', 'USD', 'GBP'] as const;

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(120, 'That name is too long'),
  currency: z.enum(CURRENCIES),
});

type ProfileValues = z.infer<typeof profileSchema>;

/**
 * Gives `PATCH /users/me` a home. It also happens to be the page the OAuth
 * refusal message sends people to, so it has to exist for that message to be
 * actionable.
 */
export function ProfileForm() {
  const { user, adoptProfile } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: {
      displayName: user?.displayName ?? '',
      currency: (user?.currency as ProfileValues['currency']) ?? 'TND',
    },
  });

  const save = useMutation({
    mutationFn: (values: ProfileValues) => api.patch<AuthUser>('/users/me', { body: values }),
    onSuccess: (updated) => {
      toast.success('Profile updated');
      // The signed-in user lives in the auth context, so without this the
      // greeting and the account menu keep the old name until a reload.
      adoptProfile(updated);
      // Re-baselines the form so the Save button goes quiet again.
      reset({ displayName: updated.displayName, currency: updated.currency as ProfileValues['currency'] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not save your profile.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Your email address is fixed for now — changing it needs a verification step that arrives with the
          notification work.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
          <FormField
            id="displayName"
            label="Name"
            autoComplete="name"
            error={errors.displayName?.message}
            {...register('displayName')}
          />

          <div className="space-y-2">
            <label htmlFor="currency" className="text-sm font-medium">
              Currency
            </label>
            <select
              id="currency"
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              {...register('currency')}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Amounts are stored exactly; this only changes how they are shown.
            </p>
          </div>

          <Button type="submit" disabled={!isDirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
