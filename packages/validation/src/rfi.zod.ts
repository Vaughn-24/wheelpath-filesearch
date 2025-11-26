import { z } from 'zod';

export const RfiSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  docType: z.literal('rfi'),
  docNumber: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  status: z.enum([
    'draft',
    'submitted',
    'awaitingAnswer',
    'answeredPendingReview',
    'closed',
    'void',
  ]),
  dueDate: z.string().date().optional(),
  ballInCourtPersonId: z.string().optional(),
  officialAnswer: z.string().optional(),
  answerByPersonId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  extras: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type RfiInput = z.infer<typeof RfiSchema>;
