import { z } from 'zod';

const apiMetaSchema = z.object({
  requestId: z.string().min(1),
  cursor: z.string().min(1).nullable().optional(),
  hasMore: z.boolean().optional(),
  /** Optional non-production timing / debug (see Phase 3) */
  debug: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Validated API success envelope. Use `apiEnvelopeSchema(dataSchema).parse(...)` at boundaries.
 */
export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: apiMetaSchema,
  });
}

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
