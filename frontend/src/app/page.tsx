import { Fuel, Receipt, Wrench, Bell, FileText, TrendingUp } from 'lucide-react';
import type { ComponentType } from 'react';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SystemStatusCard } from '@/features/system/system-status-card';

const CAPABILITIES: { title: string; description: string; Icon: ComponentType<{ className?: string }> }[] = [
  {
    title: 'Fuel & consumption',
    description:
      'Full-to-full consumption maths that accounts for partial fills and missed logs, not a naive two-point average.',
    Icon: Fuel,
  },
  {
    title: 'Every expense',
    description: 'Insurance, tyres, tolls, parking and repairs in one ledger, categorised and searchable.',
    Icon: Receipt,
  },
  {
    title: 'Maintenance schedules',
    description: 'Service intervals by distance, by time, or both — with a clear due / overdue status.',
    Icon: Wrench,
  },
  {
    title: 'Reminders that arrive',
    description: 'Background workers watch insurance expiry, inspections and upcoming services.',
    Icon: Bell,
  },
  {
    title: 'Documents in order',
    description: 'Registration, insurance and invoices stored safely, with expiry tracking.',
    Icon: FileText,
  },
  {
    title: 'Cost of ownership',
    description: 'Cost per kilometre, monthly and yearly trends, and where the money actually goes.',
    Icon: TrendingUp,
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="grid gap-10 py-16 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16 lg:py-24">
          <div className="space-y-6">
            <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
              Personal vehicle management
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              How much is your car <span className="text-primary">actually</span> costing you?
            </h1>
            <p className="text-muted-foreground max-w-xl text-pretty text-lg">
              CarCare turns fuel receipts, service invoices and insurance renewals into one honest number —
              your true cost per kilometre — and tells you what needs attention next.
            </p>
          </div>

          <SystemStatusCard />
        </section>

        <section aria-labelledby="capabilities" className="pb-20">
          <h2 id="capabilities" className="sr-only">
            Capabilities
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ title, description, Icon }) => (
              <Card key={title} className="h-full">
                <CardHeader>
                  <Icon className="text-primary size-5" aria-hidden />
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription className="text-pretty">{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>CarCare — built as a production-grade portfolio project.</p>
          <p>Next.js · NestJS · PostgreSQL · Redis</p>
        </div>
      </footer>
    </>
  );
}
