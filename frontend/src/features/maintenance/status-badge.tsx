import { Badge } from '@/components/ui/badge';
import { statusLabel } from '@/lib/maintenance/format';
import { type MaintenanceStatus } from '@/lib/maintenance/types';
import { cn } from '@/lib/utils';

const WARNING = 'bg-warning/12 text-warning dark:bg-warning/20';

const CLASSES: Record<MaintenanceStatus, string> = {
  OVERDUE: '',
  DUE: WARNING,
  DUE_SOON: WARNING,
  UPCOMING: '',
  UNKNOWN: 'text-muted-foreground',
};

/** Colour carries urgency, and the word carries it too, for anyone who cannot see the colour. */
export function StatusBadge({ status, paused = false }: { status: MaintenanceStatus; paused?: boolean }) {
  if (paused) return <Badge variant="outline">Paused</Badge>;
  const variant = status === 'OVERDUE' ? 'destructive' : status === 'UPCOMING' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className={cn(CLASSES[status], status === 'DUE_SOON' && 'border-warning/40')}>
      {statusLabel(status)}
    </Badge>
  );
}

const BAR: Record<MaintenanceStatus, string> = {
  OVERDUE: 'bg-destructive',
  DUE: 'bg-warning',
  DUE_SOON: 'bg-warning',
  UPCOMING: 'bg-primary',
  UNKNOWN: 'bg-muted-foreground',
};

/** How far through its interval a service is. Decorative: the summary beside it says the same in words. */
export function DueBar({ status, progress }: { status: MaintenanceStatus; progress: number }) {
  return (
    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
      <div
        className={cn('h-full rounded-full', BAR[status])}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}
