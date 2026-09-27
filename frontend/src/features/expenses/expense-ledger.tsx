'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { expenseKeys, expensesApi } from '@/lib/expenses/expenses-api';
import { categoryLabel, dayRange, formatExpenseDate } from '@/lib/expenses/format';
import {
  EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseCategory,
  type ExpenseFilters,
  type ExpenseSort,
} from '@/lib/expenses/types';
import { formatMoney } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { AttachmentsPanel } from './attachments-panel';
import { ExpenseForm } from './expense-form';
import { ExpenseRow } from './expense-row';

const PAGE_SIZE = 20;

const SORT_LABELS: Record<ExpenseSort, string> = {
  'incurredAt:desc': 'Newest first',
  'incurredAt:asc': 'Oldest first',
  'amount:desc': 'Largest first',
  'amount:asc': 'Smallest first',
};

/** Waits for typing to pause, so a search is one request rather than one per key. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * "Fuel, 45.500 TND on 27 Sept 2026" — so each row's buttons are told apart by
 * a screen reader, which would otherwise announce a column of identical
 * "Edit" and "Delete" with nothing to say which expense each one touches.
 */
function describeExpense(expense: Expense, currency: string): string {
  return `${categoryLabel(expense.category)}, ${formatMoney(expense.amount, currency)} on ${formatExpenseDate(expense.incurredAt)}`;
}

function DeleteButton({ expense, currency }: { expense: Expense; currency: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const described = describeExpense(expense, currency);

  const remove = useMutation({
    mutationFn: () => expensesApi.remove(expense.id),
    onSuccess: async () => {
      toast.success('Expense deleted');
      // Its mileage reading goes with it, so the vehicle's caches move too.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not delete that expense.');
    },
  });

  // Two steps rather than a dialog: deleting is permanent, and a single stray
  // tap on a phone should not be enough.
  return confirming ? (
    <span className="flex gap-1">
      <Button
        size="xs"
        variant="destructive"
        aria-label={`Confirm deleting ${described}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? 'Deleting…' : 'Delete'}
      </Button>
      <Button size="xs" variant="ghost" aria-label={`Keep ${described}`} onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  ) : (
    <Button size="xs" variant="ghost" aria-label={`Delete ${described}`} onClick={() => setConfirming(true)}>
      Delete
    </Button>
  );
}

export interface ExpenseLedgerProps {
  vehicleId: string;
  /** The vehicle's currency, never the viewer's — see RecentExpenses. */
  currency: string;
  startAdding?: boolean;
}

export function ExpenseLedger({ vehicleId, currency, startAdding = false }: ExpenseLedgerProps) {
  const [adding, setAdding] = useState(startAdding);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attachmentsId, setAttachmentsId] = useState<string | null>(null);

  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ExpenseSort>('incurredAt:desc');

  const debouncedSearch = useDebounced(search.trim(), 300);

  /*
   * Any change to what is being asked for starts again from the first page —
   * staying on page 4 of a narrower result usually means an empty page. The
   * page is remembered together with the query it belongs to and derived from
   * it, rather than reset by an effect, which would render once with the stale
   * page and fetch it before correcting itself.
   */
  const queryIdentity = JSON.stringify([category, fromDay, toDay, debouncedSearch, sort]);
  const [paging, setPaging] = useState({ query: queryIdentity, page: 1 });
  const page = paging.query === queryIdentity ? paging.page : 1;
  const setPage = (next: number) => setPaging({ query: queryIdentity, page: next });

  const invertedRange = Boolean(fromDay && toDay && fromDay > toDay);

  const filters: ExpenseFilters = {
    ...(category ? { category } : {}),
    ...dayRange(fromDay, toDay),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    sort,
    page,
    limit: PAGE_SIZE,
  };

  const expenses = useQuery({
    queryKey: expenseKeys.list(vehicleId, filters),
    queryFn: () => expensesApi.list(vehicleId, filters),
    // Caught here rather than sent: the API would answer 400, and the message
    // is clearer next to the date inputs than in a failed list.
    enabled: !invertedRange,
    placeholderData: (previous) => previous,
  });

  const filtered = Boolean(category || fromDay || toDay || debouncedSearch);

  const clearFilters = () => {
    setCategory('');
    setFromDay('');
    setToDay('');
    setSearch('');
  };

  return (
    <div className="space-y-6">
      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New expense</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm vehicleId={vehicleId} onDone={() => setAdding(false)} />
          </CardContent>
        </Card>
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Add expense
        </Button>
      )}

      <Card>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="expense-search">Search</Label>
              <Input
                id="expense-search"
                type="search"
                placeholder="Vendor or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-category">Category</Label>
              <NativeSelect
                id="expense-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as ExpenseCategory | '')}
              >
                <option value="">All categories</option>
                {EXPENSE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {categoryLabel(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-from">From</Label>
              <Input
                id="expense-from"
                type="date"
                value={fromDay}
                aria-invalid={invertedRange}
                onChange={(event) => setFromDay(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-to">To</Label>
              <Input
                id="expense-to"
                type="date"
                value={toDay}
                aria-invalid={invertedRange}
                aria-describedby={invertedRange ? 'expense-range-error' : undefined}
                onChange={(event) => setToDay(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="expense-sort" className="text-muted-foreground text-xs font-normal">
                Sort
              </Label>
              <NativeSelect
                id="expense-sort"
                className="h-8 w-auto"
                value={sort}
                onChange={(event) => setSort(event.target.value as ExpenseSort)}
              >
                {(Object.keys(SORT_LABELS) as ExpenseSort[]).map((value) => (
                  <option key={value} value={value}>
                    {SORT_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {filtered ? (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          {invertedRange ? (
            <p id="expense-range-error" role="alert" className="text-destructive text-sm">
              The start date is after the end date.
            </p>
          ) : expenses.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : expenses.isError ? (
            // Distinct from "no expenses": presenting a failed request as an
            // empty ledger invites someone to re-enter costs already stored.
            <div className="space-y-2">
              <p role="alert" className="text-sm font-medium">
                Could not load expenses
              </p>
              <p className="text-muted-foreground text-sm">
                {expenses.error instanceof Error ? expenses.error.message : 'Something went wrong.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void expenses.refetch()}>
                Try again
              </Button>
            </div>
          ) : expenses.data?.data.length ? (
            <ul className="divide-border divide-y">
              {expenses.data.data.map((expense) => (
                <li key={expense.id}>
                  {editingId === expense.id ? (
                    <div className="py-4">
                      <ExpenseForm
                        vehicleId={vehicleId}
                        expense={expense}
                        onDone={() => setEditingId(null)}
                      />
                    </div>
                  ) : (
                    <>
                      <ExpenseRow
                        expense={expense}
                        currency={currency}
                        actions={
                          <span className="flex gap-1">
                            {/*
                             * Offered on every row, derived ones included: a
                             * receipt changes nothing about the amount, so it
                             * belongs wherever the cost came from.
                             */}
                            <Button
                              size="xs"
                              variant={attachmentsId === expense.id ? 'secondary' : 'ghost'}
                              aria-expanded={attachmentsId === expense.id}
                              aria-controls={`attachments-${expense.id}`}
                              aria-label={`Attachments for ${describeExpense(expense, currency)}`}
                              onClick={() =>
                                setAttachmentsId((open) => (open === expense.id ? null : expense.id))
                              }
                            >
                              <Paperclip className="size-3" aria-hidden />
                              Files
                            </Button>
                            {/* A fuel- or service-derived row is changed where it
                                came from; the API would refuse it with a 409. */}
                            {expense.sourceType === 'MANUAL' ? (
                              <>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={`Edit ${describeExpense(expense, currency)}`}
                                  onClick={() => setEditingId(expense.id)}
                                >
                                  Edit
                                </Button>
                                <DeleteButton expense={expense} currency={currency} />
                              </>
                            ) : null}
                          </span>
                        }
                      />
                      {attachmentsId === expense.id ? (
                        <div id={`attachments-${expense.id}`} className="pb-3">
                          <AttachmentsPanel vehicleId={vehicleId} expenseId={expense.id} />
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : filtered ? (
            <p className="text-muted-foreground text-sm">No expenses match these filters.</p>
          ) : (
            <p className="text-muted-foreground text-sm">No expenses yet. Add the first one above.</p>
          )}

          {expenses.data && expenses.data.meta.totalPages > 1 && !invertedRange ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs tabular-nums">
                Page {expenses.data.meta.page} of {expenses.data.meta.totalPages} · {expenses.data.meta.total}{' '}
                expenses
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1 || expenses.isFetching}
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!expenses.data.meta.hasNext || expenses.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
