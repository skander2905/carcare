export type DocumentStatus = 'PENDING_UPLOAD' | 'READY' | 'FAILED';

/** Mirrors the API's `DocumentResponse`. */
export interface StoredDocument {
  id: string;
  vehicleId: string;
  expenseId: string | null;
  reminderId: string | null;
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

/** What a car's own papers can be. Mirrors the API's `DocumentType`, minus receipts and invoices. */
export type PaperType = 'REGISTRATION' | 'INSURANCE' | 'INSPECTION' | 'PURCHASE' | 'OTHER';

/**
 * Who a file belongs to: an expense (a receipt), a reminder (the insurance
 * certificate), or the car itself (one of its papers).
 */
export type FileOwner = { expenseId: string } | { reminderId: string } | { paper: PaperType; title?: string };
