'use client';

import { useMutation } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api/client';
import { accountEmailApi } from '@/lib/auth/account-email-api';

/** Shown until the address is confirmed: without it, reminder emails quietly never arrive. */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const resend = useMutation({
    mutationFn: accountEmailApi.resendVerification,
    onSuccess: () => toast.success(`Sent. Check ${user?.email ?? 'your inbox'}, and the spam folder.`),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send it. Try again later.'),
  });

  if (!user || user.emailVerified) return null;

  return (
    <div className="border-warning/30 bg-warning/10 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <MailWarning className="text-warning size-4 shrink-0" aria-hidden />
        <span className="flex-1">
          Confirm your email to get reminders by email. We sent a link to <strong>{user.email}</strong>.
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={resend.isPending || resend.isSuccess}
          onClick={() => resend.mutate()}
        >
          {resend.isSuccess ? 'Sent' : resend.isPending ? 'Sending…' : 'Send it again'}
        </Button>
      </div>
    </div>
  );
}
