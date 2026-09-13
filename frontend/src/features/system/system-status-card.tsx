'use client';

import { AlertCircle, CheckCircle2, CircleSlash, Loader2, TriangleAlert } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSystemHealth, type DependencyStatus } from './use-system-health';

const LABELS: Record<string, string> = {
  database: 'PostgreSQL',
  redis: 'Redis',
};

const PRESENTATION: Record<
  DependencyStatus,
  { label: string; Icon: ComponentType<{ className?: string }>; className: string }
> = {
  up: { label: 'Operational', Icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  degraded: { label: 'Degraded', Icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400' },
  down: { label: 'Unavailable', Icon: CircleSlash, className: 'text-destructive' },
};

function DependencyRow({
  name,
  detail,
}: {
  name: string;
  detail: { status: DependencyStatus; responseTimeMs?: number };
}) {
  const { label, Icon, className } = PRESENTATION[detail.status];

  return (
    <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-foreground font-medium">{LABELS[name] ?? name}</span>
      <span className="flex items-center gap-2">
        {typeof detail.responseTimeMs === 'number' ? (
          <span className="text-muted-foreground tabular-nums">{detail.responseTimeMs} ms</span>
        ) : null}
        <span className={`flex items-center gap-1.5 font-medium ${className}`}>
          <Icon className="size-4" aria-hidden />
          {label}
        </span>
      </span>
    </li>
  );
}

/**
 * Live end-to-end proof that the stack is wired up: browser -> API -> Postgres
 * and Redis. It is also the reference implementation for this project's three
 * required UI states — loading, error, and loaded.
 */
export function SystemStatusCard() {
  const { data, isPending, isError } = useSystemHealth();

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">System status</CardTitle>
            <CardDescription>Live health of the API and its dependencies.</CardDescription>
          </div>
          {data ? (
            <Badge variant={data.status === 'ok' ? 'secondary' : 'destructive'}>
              {data.status === 'ok' ? 'All systems go' : 'Impaired'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading system status">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        ) : isError ? (
          <div className="text-muted-foreground flex items-start gap-3 text-sm">
            <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              The API is not reachable. Start it with{' '}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">docker compose up</code>, then this card
              updates automatically.
            </p>
          </div>
        ) : (
          <ul className="divide-border/60 divide-y">
            {Object.entries(data.details).map(([name, detail]) => (
              <DependencyRow key={name} name={name} detail={detail} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SystemStatusCardFallback() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">System status</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Checking…
      </CardContent>
    </Card>
  );
}
