'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { documentKeys, documentsApi } from '@/lib/documents/documents-api';
import { formatFileSize } from '@/lib/documents/files';
import { type StoredDocument } from '@/lib/documents/types';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { AttachmentPicker } from './attachment-picker';
import { useAttachFiles } from './use-attach-files';

/**
 * Opens a stored file in a new tab.
 *
 * The tab is opened *before* the link is fetched: browsers only allow a popup
 * directly inside a click, and awaiting the API first would get it blocked.
 * The link itself is fetched fresh each time because it expires in minutes.
 */
async function openDocument(document: StoredDocument): Promise<void> {
  const tab = window.open('', '_blank');

  try {
    const { url } = await documentsApi.downloadUrl(document.id);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    tab?.close();
    toast.error(error instanceof ApiError ? error.message : 'Could not open that file.');
  }
}

function AttachmentItem({ document }: { document: StoredDocument }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => documentsApi.remove(document.id),
    onSuccess: async () => {
      toast.success('Attachment removed');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not remove that attachment.');
    },
  });

  const Icon = document.mimeType === 'application/pdf' ? FileText : ImageIcon;

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm">{document.fileName}</p>
          <p className="text-muted-foreground text-xs">{formatFileSize(document.sizeBytes)}</p>
        </div>
      </div>

      <span className="flex shrink-0 gap-1">
        <Button
          size="xs"
          variant="ghost"
          aria-label={`View ${document.fileName}`}
          onClick={() => void openDocument(document)}
        >
          View
        </Button>
        {confirming ? (
          <>
            <Button
              size="xs"
              variant="destructive"
              aria-label={`Confirm removing ${document.fileName}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Remove ${document.fileName}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        )}
      </span>
    </li>
  );
}

/** An expense's receipts and invoices: view them, remove them, add more. */
export function AttachmentsPanel({ vehicleId, expenseId }: { vehicleId: string; expenseId: string }) {
  const { attach, progress, busy } = useAttachFiles(vehicleId);

  const documents = useQuery({
    queryKey: documentKeys.forExpense(vehicleId, expenseId),
    queryFn: () => documentsApi.listForExpense(vehicleId, expenseId),
  });

  return (
    <div className="bg-muted/40 space-y-3 rounded-md px-3 py-3">
      {documents.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : documents.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm">
            Could not load the attachments.
          </p>
          <Button size="xs" variant="outline" onClick={() => void documents.refetch()}>
            Try again
          </Button>
        </div>
      ) : documents.data?.length ? (
        <ul className="divide-border divide-y">
          {documents.data.map((document) => (
            <AttachmentItem key={document.id} document={document} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No receipt or invoice attached.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <AttachmentPicker disabled={busy} onFiles={(files) => void attach(expenseId, files)} />
        {progress ? (
          <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            Uploading {progress.fileName} · {Math.round(progress.fraction * 100)}%
          </p>
        ) : null}
      </div>
    </div>
  );
}
