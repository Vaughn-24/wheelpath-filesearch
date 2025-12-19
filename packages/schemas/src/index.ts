import rfiSchema from '../rfi.schema.json';

export type DocType = 'rfi';

export const SchemaCatalog: Record<DocType, unknown> = {
  rfi: rfiSchema,
};

export function getSchema(docType: DocType) {
  return SchemaCatalog[docType];
}

// --- Firestore Data Models ---

export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'error';

export interface DocumentStats {
  pageCount: number;
  chunkCount: number;
}

export interface Document {
  id: string;
  tenantId: string;
  title: string;
  gcsPath: string;       // "gs://bucket/user/file.pdf"
  mimeType: string;
  status: DocumentStatus;
  stats?: DocumentStats;
  createdAt: string | Date; // Allow flexibility for client/server timestamps
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
