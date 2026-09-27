'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { attachFile } from '@/lib/documents/documents-api';
import { attachmentProblem } from '@/lib/documents/files';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';

export interface UploadProgress {
  fileName: string;
  /** 0 to 1. */
  fraction: number;
}

/**
 * Uploads files to an expense one at a time, reporting progress.
 *
 * One at a time rather than all at once: on a phone connection, parallel
 * uploads share the same thin pipe, so nothing finishes sooner — and each
 * file failing or succeeding on its own is easier to explain.
 */
export function useAttachFiles(vehicleId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const attach = async (expenseId: string, files: File[]): Promise<void> => {
    // Checked before anything is sent: a 30 MB video should be refused here,
    // not after it has half-uploaded.
    const accepted: File[] = [];
    for (const file of files) {
      const problem = attachmentProblem(file);
      if (problem) toast.error(problem);
      else accepted.push(file);
    }

    let attached = 0;

    for (const file of accepted) {
      setProgress({ fileName: file.name, fraction: 0 });
      try {
        await attachFile(vehicleId, expenseId, file, (fraction) =>
          setProgress({ fileName: file.name, fraction }),
        );
        attached += 1;
      } catch (error) {
        toast.error(
          `${file.name} was not attached: ${error instanceof ApiError || error instanceof Error ? error.message : 'something went wrong'}`,
        );
      }
    }

    setProgress(null);

    if (attached > 0) {
      toast.success(attached === 1 ? 'Attachment added' : `${attached} attachments added`);
      // The attachment list and the expense's paperclip count both live under
      // the vehicle's keys.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    }
  };

  return { attach, progress, busy: progress !== null };
}
