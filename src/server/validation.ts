// src/server/validation.ts
// Scheme Zod pentru validarea cererilor de audit și remediere prețuri

import { z } from 'zod';

export const priceAuditCategorySchema = z.enum([
  'anomalies',
  'confirmed_wrong',
  'suspect_unverified',
  'valid_verified',
  'isolated',
  'all'
]);

export const priceAuditQuerySchema = z.object({
  category: priceAuditCategorySchema.default('all'),
  retailerId: z.string().trim().max(64).default('toate'),
  search: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25)
});

export const remediationActionSchema = z.enum(['fix_price', 'isolate', 'verify']);

export const priceAuditRemediationItemSchema = z
  .object({
    offerId: z.string().trim().min(1, 'ID-ul ofertei este obligatoriu.').max(160),
    action: remediationActionSchema,
    newPrice: z.coerce.number().positive('Prețul nou trebuie să fie pozitiv.').max(50000).optional(),
    newNormalPrice: z.coerce.number().positive().max(50000).nullable().optional(),
    newPromoPrice: z.coerce.number().positive().max(50000).nullable().optional(),
    reason: z.string().trim().max(500).optional()
  })
  .superRefine((val, ctx) => {
    if (val.action === 'fix_price' && (val.newPrice === undefined || !Number.isFinite(val.newPrice) || val.newPrice <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPrice'],
        message: 'Pentru acțiunea fix_price este necesar un preț valid > 0.'
      });
    }
    if (
      val.newNormalPrice !== undefined &&
      val.newNormalPrice !== null &&
      val.newPromoPrice !== undefined &&
      val.newPromoPrice !== null &&
      val.newPromoPrice > val.newNormalPrice + 0.01
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPromoPrice'],
        message: 'Prețul promoțional nu poate depăși prețul normal.'
      });
    }
  });

export const priceAuditRemediationRequestSchema = z
  .object({
    dryRun: z.boolean().default(false),
    userEmail: z.string().trim().email().max(160).optional(),
    offerId: z.string().trim().min(1).max(160).optional(),
    action: remediationActionSchema.optional(),
    newPrice: z.coerce.number().positive().max(50000).optional(),
    newNormalPrice: z.coerce.number().positive().max(50000).nullable().optional(),
    newPromoPrice: z.coerce.number().positive().max(50000).nullable().optional(),
    reason: z.string().trim().max(500).optional(),
    items: z.array(priceAuditRemediationItemSchema).min(1).max(500).optional()
  })
  .superRefine((val, ctx) => {
    const hasBatch = Array.isArray(val.items) && val.items.length > 0;
    const hasSingle = Boolean(val.offerId && val.action);
    if (!hasBatch && !hasSingle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Trebuie specificat fie un câmp items[], fie offerId și action.'
      });
    }
    if (hasSingle && val.action === 'fix_price' && (val.newPrice === undefined || !Number.isFinite(val.newPrice) || val.newPrice <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPrice'],
        message: 'Pentru fix_price trebuie furnizat newPrice > 0.'
      });
    }
    if (
      hasSingle &&
      val.newNormalPrice !== undefined &&
      val.newNormalPrice !== null &&
      val.newPromoPrice !== undefined &&
      val.newPromoPrice !== null &&
      val.newPromoPrice > val.newNormalPrice + 0.01
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPromoPrice'],
        message: 'Prețul promoțional nu poate depăși prețul normal.'
      });
    }
  });

export type PriceAuditQueryInput = z.infer<typeof priceAuditQuerySchema>;
export type PriceAuditRemediationItemInput = z.infer<typeof priceAuditRemediationItemSchema>;
export type PriceAuditRemediationRequestInput = z.infer<typeof priceAuditRemediationRequestSchema>;
