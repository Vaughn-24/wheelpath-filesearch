import rfiSchema from '../rfi.schema.json';

export type DocType = 'rfi';

export const SchemaCatalog: Record<DocType, unknown> = {
  rfi: rfiSchema,
};

export function getSchema(docType: DocType) {
  return SchemaCatalog[docType];
}

// --- Firestore Data Models ---

export type DocumentStatus = 'uploading' | 'indexing' | 'ready' | 'error';

export interface Document {
  id: string;
  tenantId: string;
  title: string;
  fileSearchDocumentName: string; // File Search document reference
  mimeType: string;
  status: DocumentStatus;
  sizeBytes: number;
  createdAt: string | Date;
  errorMessage?: string;
}

export interface Message {
  role: 'user' | 'model';
  content: string;
  citations?: string[];
  createdAt: string | Date;
}

export interface Chat {
  id: string;
  documentId: string;
  messages: Message[];
  createdAt: string | Date;
  updatedAt: string | Date;
}
