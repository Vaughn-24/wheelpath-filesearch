// Generated from rfi.schema.json (M3 bootstrap)
export interface Rfi {
  tenantId: string;
  projectId: string;
  docType: 'rfi';
  docNumber: string;
  title: string;
  question: string;
  status: 'draft' | 'submitted' | 'awaitingAnswer' | 'answeredPendingReview' | 'closed' | 'void';
  dueDate?: string; // date
  ballInCourtPersonId?: string;
  officialAnswer?: string;
  answerByPersonId?: string;
  createdAt?: string; // date-time
  updatedAt?: string; // date-time
  extras?: Record<string, string | number | boolean | null>;
}
