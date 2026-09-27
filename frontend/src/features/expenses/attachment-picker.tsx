'use client';

import { Paperclip } from 'lucide-react';
import { useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ATTACHMENT_ACCEPT } from '@/lib/documents/files';

export interface AttachmentPickerProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * A button that opens the file picker.
 *
 * `accept="image/*"` is what makes a phone offer "Take photo" alongside its
 * files, which is the scanning. There is deliberately no `capture` attribute:
 * it would force the camera and hide the option of picking a PDF the garage
 * emailed over.
 */
export function AttachmentPicker({
  onFiles,
  disabled,
  label = 'Attach photo or PDF',
}: AttachmentPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden />
        {label}
      </Button>
    </>
  );
}
