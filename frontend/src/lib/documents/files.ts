/** The server's rules (documents/dto/document.dto.ts), checked before any upload starts. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

/** What the file picker offers. `image/*` lets a phone offer its camera. */
export const ATTACHMENT_ACCEPT = 'image/*,application/pdf,.heic,.heif';

const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/**
 * The file's type, falling back to its extension.
 *
 * Browsers other than Safari do not recognise HEIC, the iPhone camera's
 * default, and report it with an empty `type`. Trusting that blank would
 * reject the most common receipt photo there is.
 */
export function resolveMimeType(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? '';
}

/** Why a file cannot be attached, or null if it can. */
export function attachmentProblem(file: { name: string; type: string; size: number }): string | null {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(resolveMimeType(file))) {
    return `${file.name} is not a photo or a PDF`;
  }
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is over 10 MB`;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
