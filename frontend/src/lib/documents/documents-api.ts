import { api } from '@/lib/api/client';
import { resolveMimeType } from './files';
import { type StoredDocument, type UploadUrlResponse } from './types';

export const documentsApi = {
  listForExpense: (vehicleId: string, expenseId: string) =>
    api.get<StoredDocument[]>(`/vehicles/${vehicleId}/documents`, { query: { expenseId } }),

  requestUpload: (
    vehicleId: string,
    body: { expenseId: string; fileName: string; mimeType: string; sizeBytes: number; type?: string },
  ) => api.post<UploadUrlResponse>(`/vehicles/${vehicleId}/documents/upload-url`, { body }),

  confirm: (id: string) => api.post<StoredDocument>(`/documents/${id}/confirm`),

  downloadUrl: (id: string) => api.get<{ url: string; expiresAt: string }>(`/documents/${id}/download-url`),

  remove: (id: string) => api.delete<void>(`/documents/${id}`),
};

export const documentKeys = {
  forExpense: (vehicleId: string, expenseId: string) =>
    ['vehicles', vehicleId, 'documents', { expenseId }] as const,
};

/**
 * PUT straight to storage. XHR rather than fetch, because fetch still cannot
 * report upload progress, and a 5 MB photo on mobile data takes long enough
 * that a frozen button reads as broken.
 *
 * No credentials and no Authorization header: the signature in the URL is the
 * authorisation, and the store must never see the API's bearer token.
 */
function putToStorage(
  upload: UploadUrlResponse['upload'],
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The file could not be stored (${xhr.status})`));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));

    xhr.send(file);
  });
}

/**
 * The whole attachment flow: ask for a signed URL, upload, confirm.
 *
 * If the upload or the confirmation fails, the pending document is left for
 * the server's sweep rather than deleted here — a delete could fail too, and
 * a pending row is never shown or counted.
 */
export async function attachFile(
  vehicleId: string,
  expenseId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<StoredDocument> {
  const { document, upload } = await documentsApi.requestUpload(vehicleId, {
    expenseId,
    fileName: file.name,
    mimeType: resolveMimeType(file),
    sizeBytes: file.size,
  });

  await putToStorage(upload, file, onProgress);
  return documentsApi.confirm(document.id);
}
