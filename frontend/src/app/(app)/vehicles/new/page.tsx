'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleForm } from '@/features/vehicles/vehicle-form';

export default function NewVehiclePage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Add a vehicle</CardTitle>
          <CardDescription>
            Only the first four fields are required. Everything else can be filled in later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VehicleForm />
        </CardContent>
      </Card>
    </div>
  );
}
