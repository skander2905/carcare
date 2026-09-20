'use client';

import { ConnectedAccounts } from '@/features/settings/connected-accounts';
import { ProfileForm } from '@/features/settings/profile-form';

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Your profile and how you sign in.</p>
      </div>

      <ProfileForm />
      <ConnectedAccounts />
    </div>
  );
}
