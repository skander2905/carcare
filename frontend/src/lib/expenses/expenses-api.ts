import { api } from '@/lib/api/client';
import { type Paginated } from '@/lib/vehicles/types';
import { type CreateExpenseInput, type Expense, type ExpenseFilters, type UpdateExpenseInput } from './types';

export const expensesApi = {
  list: (vehicleId: string, filters: ExpenseFilters = {}) =>
    api.get<Paginated<Expense>>(`/vehicles/${vehicleId}/expenses`, { query: { ...filters } }),

  /**
   * `idempotencyKey` makes a retry of the same submission safe: the API
   * replays the expense it already created instead of filing a second one.
   */
  create: (vehicleId: string, input: CreateExpenseInput, idempotencyKey?: string) =>
    api.post<Expense>(`/vehicles/${vehicleId}/expenses`, {
      body: input,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }),

  update: (id: string, input: UpdateExpenseInput) => api.patch<Expense>(`/expenses/${id}`, { body: input }),

  remove: (id: string) => api.delete<void>(`/expenses/${id}`),
};

/**
 * Every expense query sits under `['vehicles', id, 'expenses']`, so
 * invalidating `vehicleKeys.all` after a mileage change reaches them too.
 */
export const expenseKeys = {
  all: (vehicleId: string) => ['vehicles', vehicleId, 'expenses'] as const,
  list: (vehicleId: string, filters: ExpenseFilters) => ['vehicles', vehicleId, 'expenses', filters] as const,
};
