'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AttachmentPicker } from '@/features/expenses/attachment-picker';
import { AttachmentItem } from '@/features/expenses/attachments-panel';
import { useAttachFiles } from '@/features/expenses/use-attach-files';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { documentKeys, documentsApi } from '@/lib/documents/documents-api';
import { type PaperType } from '@/lib/documents/types';

const PAPER_LABELS: Record<PaperType, string> = {
  REGISTRATION: 'Registration card',
  INSURANCE: 'Insurance certificate',
  INSPECTION: 'Inspection certificate',
  PURCHASE: 'Purchase papers',
  OTHER: 'Other paper',
};
const PAPER_TYPES = Object.keys(PAPER_LABELS) as PaperType[];
const isPaperType = (type: string): type is PaperType => type in PAPER_LABELS;

/**
 * The car's glovebox: papers to have to hand on the phone — the registration
 * card at a police check, the purchase papers when selling. No expiry dates
 * here: renewals are reminders, and a reminder can hold its own certificate.
 */
export function CarPapersCard({ vehicleId }: { vehicleId: string }) {
  const owner = { paper: 'OTHER' as PaperType };
  const [kind, setKind] = useState<PaperType>('REGISTRATION');
  const { attach, progress, busy } = useAttachFiles(vehicleId);

  const papers = useQuery({
    queryKey: documentKeys.forOwner(vehicleId, owner),
    queryFn: () => documentsApi.listFor(vehicleId, owner),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Car papers</CardTitle>
        <CardDescription>
          Registration card, purchase papers and the like, to have to hand on your phone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {papers.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : papers.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm">
              Could not load the papers.
            </p>
            <Button size="xs" variant="outline" onClick={() => void papers.refetch()}>
              Try again
            </Button>
          </div>
        ) : papers.data?.length ? (
          <ul className="divide-border divide-y">
            {papers.data.map((document) => (
              <AttachmentItem
                key={document.id}
                document={document}
                heading={isPaperType(document.type) ? PAPER_LABELS[document.type] : document.title}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No papers yet.</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Add a paper</legend>
          <div className="flex flex-wrap gap-2">
            {PAPER_TYPES.map((type) => (
              <ChoiceChip key={type} selected={kind === type} onClick={() => setKind(type)}>
                {PAPER_LABELS[type]}
              </ChoiceChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AttachmentPicker
              disabled={busy}
              label={`Add ${PAPER_LABELS[kind].toLowerCase()}`}
              onFiles={(files) => void attach({ paper: kind, title: PAPER_LABELS[kind] }, files)}
            />
            {progress ? (
              <span className="text-muted-foreground text-sm" aria-live="polite">
                Uploading {progress.fileName}… {Math.round(progress.fraction * 100)}%
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            A photo or a PDF. Insurance renewals are better kept on their reminder, which tells you when it is
            due.
          </p>
        </fieldset>
      </CardContent>
    </Card>
  );
}
