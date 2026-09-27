'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { expenseKeys, expensesApi } from '@/lib/expenses/expenses-api';
import { type ExpenseFilters } from '@/lib/expenses/types';
import { ExpenseRow } from './expense-row';

const RECENT: ExpenseFilters = { page: 1, limit: 5 };

/**
 * The five latest costs on the vehicle page, with a way into the full ledger.
 *
 * `currency` is the vehicle's — its owner's — never the viewer's: amounts carry
 * no currency of their own, and a shared member may prefer a different one.
 */
export function RecentExpenses({ vehicleId, currency }: { vehicleId: string; currency: string }) {
  const expenses = useQuery({
    queryKey: expenseKeys.list(vehicleId, RECENT),
    queryFn: () => expensesApi.list(vehicleId, RECENT),
  });

  const total = expenses.data?.meta.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Expenses</CardTitle>
        <CardDescription>
          {total > 0 ? `The latest of ${total} recorded costs.` : 'Every cost this vehicle incurs.'}
        </CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={`/vehicles/${vehicleId}/expenses${total > 0 ? '' : '?new=1'}`}>
              {total > 0 ? 'View all' : 'Add expense'}
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {expenses.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : expenses.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load expenses
            </p>
            <Button variant="outline" size="sm" onClick={() => void expenses.refetch()}>
              Try again
            </Button>
          </div>
        ) : expenses.data?.data.length ? (
          <ul className="divide-border divide-y">
            {expenses.data.data.map((expense) => (
              <li key={expense.id}>
                <ExpenseRow expense={expense} currency={currency} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No expenses yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
