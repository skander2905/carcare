export const EXPENSE_CATEGORIES = [
  'FUEL',
  'MAINTENANCE',
  'REPAIR',
  'INSURANCE',
  'TAX',
  'PARKING',
  'TOLL',
  'CLEANING',
  'ACCESSORIES',
  'TIRES',
  'INSPECTION',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseSource = 'MANUAL' | 'FUEL' | 'MAINTENANCE';

/** Mirrors the API's `ExpenseResponse`. */
export interface Expense {
  id: string;
  vehicleId: string;
  category: ExpenseCategory;
  /** Fixed to three decimal places. Never parse to a float. */
  amount: string;
  incurredAt: string;
  odometerKm: number | null;
  description: string | null;
  vendor: string | null;
  notes: string | null;
  /** Anything but MANUAL is changed through the fuel entry or service that owns it. */
  sourceType: ExpenseSource;
  /** Receipts and invoices attached and ready to view. */
  attachmentCount: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export const EXPENSE_SORTS = ['incurredAt:desc', 'incurredAt:asc', 'amount:desc', 'amount:asc'] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export interface ExpenseFilters {
  category?: ExpenseCategory;
  /** Instants, inclusive on both ends. */
  from?: string;
  to?: string;
  search?: string;
  sort?: ExpenseSort;
  page?: number;
  limit?: number;
}

export interface CreateExpenseInput {
  category: ExpenseCategory;
  amount: string;
  incurredAt?: string;
  odometerKm?: number;
  description?: string;
  vendor?: string;
  notes?: string;
}

/** On update, null clears an optional field; omitting it leaves it alone. */
export type UpdateExpenseInput = Partial<Pick<CreateExpenseInput, 'category' | 'amount' | 'incurredAt'>> & {
  odometerKm?: number | null;
  description?: string | null;
  vendor?: string | null;
  notes?: string | null;
};
