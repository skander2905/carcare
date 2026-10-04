'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/use-auth';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { api, ApiError } from '@/lib/api/client';
import { type AuthUser } from '@/lib/auth/types';

/** Whether due reminders are emailed as well as shown in the app. */
export function NotificationSettings() {
  const { user, adoptProfile } = useAuth();

  const save = useMutation({
    mutationFn: (emailNotifications: boolean) =>
      api.patch<AuthUser>('/users/me', { body: { emailNotifications } }),
    onSuccess: (updated) => {
      adoptProfile(updated);
      toast.success(updated.emailNotifications ? 'Email reminders on' : 'Email reminders off');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not change that setting.');
    },
  });

  if (!user) return null;
  const on = save.isPending ? save.variables : user.emailNotifications;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reminders</CardTitle>
        <CardDescription>
          When a service or a reminder comes due, it appears under the bell. Email adds one message, sent
          during the day, listing everything new.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Email me at {user.email}</legend>
          <div className="flex gap-2">
            <ChoiceChip selected={on} disabled={save.isPending} onClick={() => save.mutate(true)}>
              Yes
            </ChoiceChip>
            <ChoiceChip selected={!on} disabled={save.isPending} onClick={() => save.mutate(false)}>
              No, in the app only
            </ChoiceChip>
          </div>
        </fieldset>
        {user.emailVerified ? null : (
          <p className="text-warning text-sm">
            Your email isn&rsquo;t confirmed yet, so nothing is emailed. Use the link we sent, or &ldquo;Send
            it again&rdquo; at the top of the page.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          <Link href="/notifications" className="underline underline-offset-4">
            See your notifications
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
