'use client';

import { Car, Fuel, Receipt } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/use-auth';

/**
 * Placeholder for Phase 9's real dashboard. It exists now because Phase 2 needs
 * somewhere to land after signing in, and because it is the thing that proves
 * the protected-route wiring actually works end to end.
 */
const NEXT_UP = [
  { title: 'Vehicles', description: 'Add a car and its specification. Arrives in Phase 3.', Icon: Car },
  { title: 'Expenses', description: 'One ledger for every cost. Arrives in Phase 4.', Icon: Receipt },
  { title: 'Fuel', description: 'Fill-ups and true consumption. Arrives in Phase 5.', Icon: Fuel },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {user?.displayName.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground">
          You are signed in. Your vehicles and costs will appear here as the next phases land.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NEXT_UP.map(({ title, description, Icon }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-primary size-5" aria-hidden />
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
