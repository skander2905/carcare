'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VehicleList } from '@/features/vehicles/vehicle-list';

export default function VehiclesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-muted-foreground text-sm">Everything you are tracking.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/vehicles/new">
            <Plus className="size-4" aria-hidden />
            Add a vehicle
          </Link>
        </Button>
      </div>

      <VehicleList />
    </div>
  );
}
