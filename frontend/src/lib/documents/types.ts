export type DocumentStatus = 'PENDING_UPLOAD' | 'READY' | 'FAILED';

/** Mirrors the API's `DocumentResponse`. */
export interface StoredDocument {
  id: string;
  vehicleId: string;
  expenseId: string | null;
  type: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  createdAt: string;
}

export interface UploadUrlResponse {
  document: StoredDocument;
  upload: { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string };
}
