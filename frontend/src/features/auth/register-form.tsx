'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authErrorMessage } from './auth-error';
import { AuthFormShell } from './auth-form-shell';
import { FormField } from './form-field';
import { ProviderButtons } from './provider-buttons';
import { PASSWORD_MIN, registerSchema, type RegisterValues } from './auth-schemas';
import { useAuth } from './use-auth';

export function RegisterForm() {
  const { register: createAccount } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    try {
      await createAccount(values);
      // Registration signs you in, so there is no reason to ask for the
      // password again on a login screen.
      router.replace('/dashboard');
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  });

  return (
    <AuthFormShell
      title="Create your account"
      description="Start tracking what your car actually costs."
      footerPrompt="Already have an account?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="displayName"
          label="Name"
          autoComplete="name"
          autoFocus
          placeholder="Sam Ben Ali"
          error={errors.displayName?.message}
          {...register('displayName')}
        />

        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          // Stated up front rather than only after a rejected submit.
          hint={`At least ${PASSWORD_MIN} characters. A passphrase works well.`}
          error={errors.password?.message}
          {...register('password')}
        />

        {formError ? (
          <p role="alert" className="text-destructive text-sm">
            {formError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <ProviderButtons action="signup" />
    </AuthFormShell>
  );
}
