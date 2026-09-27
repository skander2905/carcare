import { type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { categoryLabel, formatExpenseDate, sourceLabel } from '@/lib/expenses/format';
import { type Expense } from '@/lib/expenses/types';
import { formatKm, formatMoney } from '@/lib/vehicles/format';

export interface ExpenseRowProps {
  expense: Expense;
  currency: string;
  /** Edit and delete controls, when the row offers them. */
  actions?: ReactNode;
}

export function ExpenseRow({ expense, currency, actions }: ExpenseRowProps) {
  const detail = [expense.description, expense.vendor].filter(Boolean).join(' · ');
  const derived = sourceLabel(expense.sourceType);

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{categoryLabel(expense.category)}</span>
          {derived ? <Badge variant="secondary">{derived}</Badge> : null}
        </div>
        {detail ? <p className="text-muted-foreground truncate text-sm">{detail}</p> : null}
        <p className="text-muted-foreground/80 text-xs">
          {formatExpenseDate(expense.incurredAt)}
          {expense.odometerKm !== null ? ` · ${formatKm(expense.odometerKm)}` : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">{formatMoney(expense.amount, currency)}</span>
        {actions}
      </div>
    </div>
  );
}
