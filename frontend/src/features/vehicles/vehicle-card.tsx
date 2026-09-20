import Link from 'next/link';
import { Fuel, Gauge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKm, vehicleSpec, vehicleTitle } from '@/lib/vehicles/format';
import { type Vehicle } from '@/lib/vehicles/types';

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Card className="hover:border-primary/40 transition-colors">
      <Link href={`/vehicles/${vehicle.id}`} className="block">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{vehicleTitle(vehicle)}</CardTitle>
              <p className="text-muted-foreground text-sm">
                {vehicle.year} · {vehicle.licensePlate}
              </p>
            </div>
            {vehicle.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
          </div>
        </CardHeader>

        <CardContent className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <span className="text-foreground inline-flex items-center gap-1.5 font-medium tabular-nums">
            <Gauge className="size-4 shrink-0" aria-hidden />
            {formatKm(vehicle.currentOdometerKm)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Fuel className="size-4 shrink-0" aria-hidden />
            {vehicleSpec(vehicle)}
          </span>
        </CardContent>
      </Link>
    </Card>
  );
}
