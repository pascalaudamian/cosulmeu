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

// =========================================================================
// Receipt Scanner 2.0 Validation & Image Binary Security
// =========================================================================

export const ALLOWED_RECEIPT_IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
] as const;

export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per page

export const receiptImagePayloadSchema = z.object({
  base64: z.string().min(32, 'Conținut imagine invalid sau gol.').max(15_000_000),
  mimeType: z.enum(ALLOWED_RECEIPT_IMAGE_MIMES).default('image/jpeg'),
  fileName: z.string().trim().max(180).optional()
});

export const scanReceiptRequestSchema = z
  .object({
    imageBase64: z.string().min(32).max(15_000_000).optional(),
    mimeType: z.string().trim().max(64).optional(),
    images: z.array(receiptImagePayloadSchema).min(1).max(6).optional(),
    qualityHints: z
      .object({
        isBlurry: z.boolean().optional(),
        blurScore: z.number().min(0).max(100).optional(),
        isOverexposed: z.boolean().optional(),
        isUnderexposed: z.boolean().optional()
      })
      .optional()
  })
  .superRefine((val, ctx) => {
    if (!val.imageBase64 && (!val.images || val.images.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Este necesară cel puțin o imagine a bonului fiscal (JPG, PNG sau WEBP).'
      });
    }
    if (val.mimeType && !ALLOWED_RECEIPT_IMAGE_MIMES.includes(val.mimeType.toLowerCase() as any)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'Format imagine neacceptat. Acceptăm exclusiv JPG, JPEG, PNG și WEBP.'
      });
    }
  });

export const parseReceiptTextRequestSchema = z.object({
  rawOcrText: z.string().trim().min(5, 'Textul bonului este prea scurt.').max(50000),
  pagesText: z.array(z.string().max(30000)).max(6).optional(),
  ocrQuality: z
    .object({
      isBlurry: z.boolean().optional(),
      blurScore: z.number().min(0).max(100).optional(),
      isOverexposed: z.boolean().optional(),
      isUnderexposed: z.boolean().optional(),
      isTruncated: z.boolean().optional(),
      ocrTextConfidence: z.number().min(0).max(100).optional()
    })
    .optional()
});

export const receiptFieldProvenanceSchema = z.enum(['ocr', 'calculated', 'manual']);

export const receiptItemSaveSchema = z.object({
  id: z.string().trim().min(1).max(120),
  rawName: z.string().trim().min(1, 'Denumirea produsului este obligatorie.').max(255),
  normalizedName: z.string().trim().max(255).optional(),
  matchedProductId: z.string().trim().max(120).optional().nullable(),
  matchedProductName: z.string().trim().max(255).optional().nullable(),
  eanCode: z.string().trim().regex(/^\d{8,14}$/).optional().nullable(),
  internalCode: z.string().trim().max(64).optional().nullable(),
  quantity: z.coerce.number().positive('Cantitatea trebuie să fie > 0.').max(5000),
  unit: z.enum(['buc', 'kg', 'g', 'l', 'ml', 'pachet']).default('buc'),
  unitPrice: z.coerce.number().min(0, 'Prețul unitar nu poate fi negativ.').max(50000),
  totalPrice: z.coerce.number().min(0, 'Totalul liniei nu poate fi negativ.').max(100000),
  discount: z.coerce.number().min(0).max(50000).default(0),
  vatRate: z.coerce.number().min(0).max(30).optional().nullable(),
  isWeighted: z.boolean().optional(),
  isSgr: z.boolean().optional(),
  isCouponOrDiscountLine: z.boolean().optional(),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  confidenceScore: z.coerce.number().min(0).max(100).optional(),
  category: z.string().trim().max(80).optional(),
  provenance: z
    .object({
      rawName: receiptFieldProvenanceSchema.optional(),
      quantity: receiptFieldProvenanceSchema.optional(),
      unitPrice: receiptFieldProvenanceSchema.optional(),
      totalPrice: receiptFieldProvenanceSchema.optional(),
      discount: receiptFieldProvenanceSchema.optional(),
      matchedProductId: receiptFieldProvenanceSchema.optional()
    })
    .optional(),
  rawLineText: z.string().max(400).optional()
});

export const saveReceiptRequestSchema = z.object({
  receipt: z.object({
    id: z.string().trim().min(1).max(120),
    storeId: z.string().trim().min(1).max(80),
    storeName: z.string().trim().min(1).max(150),
    storeAddress: z.string().trim().max(250).optional().nullable(),
    fiscalNumber: z.string().trim().max(80).optional().nullable(),
    receiptNumber: z.string().trim().max(80).optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data bonului trebuie să fie în format YYYY-MM-DD.'),
    time: z.string().trim().max(16).optional().nullable(),
    items: z.array(receiptItemSaveSchema).min(1, 'Bonul trebuie să conțină cel puțin un articol.').max(300),
    subtotal: z.coerce.number().min(0).max(200000),
    discountTotal: z.coerce.number().min(0).max(50000).default(0),
    couponsTotal: z.coerce.number().min(0).max(50000).optional(),
    sgrTotal: z.coerce.number().min(0).max(5000).optional(),
    vatTotal: z.coerce.number().min(0).max(50000).optional(),
    printedTotal: z.coerce.number().min(0).max(200000).optional(),
    calculatedTotal: z.coerce.number().min(0).max(200000).optional(),
    discrepancyAmount: z.coerce.number().min(0).max(200000).optional(),
    total: z.coerce.number().min(0).max(200000),
    currency: z.literal('RON').default('RON'),
    paymentMethod: z.string().trim().max(80).optional().nullable(),
    verifiedStatus: z.enum(['confirmed', 'draft']).default('confirmed'),
    validationStatus: z.enum(['VALID', 'NEEDS_REVIEW', 'INVALID']).optional(),
    validationReasons: z.array(z.string().max(400)).optional(),
    confidenceScores: z.record(z.string(), z.any()).optional(),
    rawOcrText: z.string().max(60000).optional().nullable(),
    originalExtractedData: z.record(z.string(), z.any()).optional().nullable(),
    userCorrections: z.record(z.string(), z.any()).optional().nullable(),
    contentFingerprint: z.string().trim().max(120).optional().nullable()
  }),
  images: z.array(receiptImagePayloadSchema).max(6).optional(),
  allowDuplicateOverride: z.boolean().default(false)
});

/**
 * Inspects decoded binary magic bytes and rejects SVG, HTML, scripts, or mismatched formats.
 */
export function validateReceiptImageBuffer(
  rawBase64OrDataUrl: string,
  declaredMime?: string
): {
  valid: boolean;
  buffer?: Buffer;
  detectedMime?: 'image/jpeg' | 'image/png' | 'image/webp';
  error?: string;
} {
  if (!rawBase64OrDataUrl || typeof rawBase64OrDataUrl !== 'string') {
    return { valid: false, error: 'Imaginea lipsește.' };
  }

  const trimmed = rawBase64OrDataUrl.trim();
  const dataUrlHeader = trimmed.match(/^data:([^;]+);base64,/i);
  if (dataUrlHeader) {
    const headerMime = dataUrlHeader[1].toLowerCase();
    if (!ALLOWED_RECEIPT_IMAGE_MIMES.includes(headerMime as any)) {
      return {
        valid: false,
        error: `Tipul MIME "${headerMime}" nu este permis. Acceptăm doar JPG, PNG și WEBP.`
      };
    }
  }

  if (declaredMime && !ALLOWED_RECEIPT_IMAGE_MIMES.includes(declaredMime.toLowerCase() as any)) {
    return {
      valid: false,
      error: `Tipul MIME declarat "${declaredMime}" nu este permis.`
    };
  }

  const pureBase64 = trimmed.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(pureBase64, 'base64');
  } catch {
    return { valid: false, error: 'Date Base64 corupte.' };
  }

  if (buffer.length < 16) {
    return { valid: false, error: 'Fișier imagine gol sau invalid.' };
  }
  if (buffer.length > MAX_RECEIPT_IMAGE_BYTES) {
    return { valid: false, error: 'Imaginea depășește limita de 10 MB per fotografie.' };
  }

  // Explicitly block disguised SVG / HTML / XML payloads
  const headText = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').trimStart().toLowerCase();
  if (
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('<!doctype') ||
    headText.startsWith('<html') ||
    headText.startsWith('<script') ||
    headText.includes('<svg')
  ) {
    return {
      valid: false,
      error: 'Conținut SVG/HTML detectat și blocat din motive de securitate.'
    };
  }

  // Magic-byte verification:
  // JPEG: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  // WEBP: "RIFF" .... "WEBP"
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (isJpeg) return { valid: true, buffer, detectedMime: 'image/jpeg' };
  if (isPng) return { valid: true, buffer, detectedMime: 'image/png' };
  if (isWebp) return { valid: true, buffer, detectedMime: 'image/webp' };

  return {
    valid: false,
    error: 'Semnătura binară a fișierului nu corespunde unei imagini valide JPG, PNG sau WEBP.'
  };
}

// =========================================================================
// GDPR & Cookie Consent Validation Schemas
// =========================================================================

export const gdprConsentRecordSchema = z.object({
  visitorSessionId: z.string().trim().min(6).max(120),
  policyVersion: z.string().trim().min(2).max(64),
  bannerVersion: z.string().trim().min(2).max(64),
  consentMethod: z.enum(['banner_accept_all', 'banner_reject_optional', 'custom_preferences', 'withdrawal']),
  categories: z.object({
    necessary: z.literal(true).default(true),
    preferences: z.boolean().default(false),
    analytics: z.boolean().default(false),
    marketing: z.boolean().default(false)
  })
});

export const gdprProfileUpdateSchema = z.object({
  firstName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().max(80).optional().nullable(),
  displayName: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email('Adresa de email este invalidă.').max(160).optional(),
  phone: z.string().trim().max(32).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  preferredLanguage: z.enum(['ro', 'en']).optional(),
  optionalNotificationsEnabled: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  restrictionRequested: z.boolean().optional(),
  restrictionReason: z.string().trim().max(400).optional().nullable()
});

export const gdprRequestTypeSchema = z.enum([
  'access_data',
  'export_data',
  'rectification',
  'erasure_account',
  'erasure_optional_data',
  'restriction_processing',
  'objection',
  'withdraw_consent',
  'other'
]);

export const gdprRequestStatusSchema = z.enum([
  'noua',
  'in_verificare',
  'procesata',
  'respinsa_justificat'
]);

export const gdprRequestCreateSchema = z.object({
  requestType: gdprRequestTypeSchema,
  details: z.string().trim().max(1500).optional().nullable(),
  requestedFormat: z.enum(['json', 'csv']).optional().nullable()
});

export const gdprAdminRequestUpdateSchema = z.object({
  status: gdprRequestStatusSchema,
  adminResponse: z.string().trim().max(2000).optional().nullable()
});

export const gdprWithdrawConsentSchema = z.object({
  channels: z
    .array(z.enum(['email_marketing', 'optional_notifications', 'price_alerts', 'cookies_optional']))
    .min(1, 'Selectează cel puțin o categorie pentru retragere.')
});

export const gdprDeleteAccountSchema = z.object({
  confirmationText: z.string().trim().refine(val => val.toUpperCase() === 'STERGE CONTUL', {
    message: 'Trebuie să tastezi exact „STERGE CONTUL” pentru a confirma ștergerea ireversibilă.'
  }),
  password: z.string().min(1).max(200).optional(),
  reason: z.string().trim().max(500).optional().nullable()
});

// =========================================================================
// V1 Roadmap: Basket Optimizer & Price History Validation
// =========================================================================

export const basketItemInputSchema = z.object({
  id: z.string().trim().min(1).max(120),
  productId: z.string().trim().max(120).optional(),
  customName: z.string().trim().max(255).optional(),
  name: z.string().trim().min(1, 'Denumirea produsului este obligatorie.').max(255),
  brand: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).default('Alte produse'),
  quantity: z.coerce.number().positive('Cantitatea trebuie să fie > 0.').max(10000),
  unit: z.enum(['buc', 'kg', 'g', 'l', 'ml', 'pachet']).default('buc'),
  checked: z.boolean().default(false),
  notes: z.string().trim().max(400).optional(),
  barcode: z.string().trim().max(64).optional(),
  preferredBrand: z.string().trim().max(120).optional(),
  referencePrice: z.coerce.number().min(0).max(50000).optional(),
  estimatedPrice: z.coerce.number().min(0).max(50000).optional()
});

export const basketOptimizeOptionsSchema = z.object({
  useLoyaltyCards: z.boolean().optional(),
  useCoupons: z.boolean().optional(),
  maxStores: z.coerce.number().int().min(1).max(8).optional(),
  excludedStoreIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  favoriteStoreIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  includeStaleOffers: z.boolean().optional(),
  maxOfferAgeDays: z.coerce.number().int().min(1).max(90).optional(),
  region: z.string().trim().max(80).optional(),
  transportCostPerExtraStore: z.coerce.number().min(0).max(500).optional(),
  clientRevision: z.string().trim().max(160).optional()
});

export const basketOptimizeRequestSchema = z.object({
  listId: z.string().trim().max(120).optional(),
  listName: z.string().trim().max(160).optional(),
  items: z.array(basketItemInputSchema).max(200).default([]),
  options: basketOptimizeOptionsSchema.optional()
});

export const priceHistoryIntervalSchema = z
  .coerce
  .number()
  .int()
  .refine((v): v is 30 | 90 | 180 | 365 => [30, 90, 180, 365].includes(v), {
    message: 'Intervalul de istoric trebuie să fie 30, 90, 180 sau 365 zile.'
  });

export const priceHistoryQuerySchema = z.object({
  days: priceHistoryIntervalSchema.default(90)
});

export const priceAlertTypeSchema = z.enum(['below_target', 'any_drop', 'interval_low']);

export const priceAlertCreateSchema = z
  .object({
    productId: z.string().trim().min(1, 'ID-ul produsului este obligatoriu.').max(64),
    alertType: priceAlertTypeSchema.default('below_target'),
    targetPrice: z.coerce.number().min(0.01, 'Prețul țintă trebuie să fie > 0.').max(50000).optional(),
    intervalDays: priceHistoryIntervalSchema.optional(),
    sourceListId: z.string().trim().uuid('ID-ul listei sursă este invalid.').optional()
  })
  .superRefine((val, ctx) => {
    if (val.alertType === 'below_target' && (val.targetPrice === undefined || val.targetPrice <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetPrice'],
        message: 'Pentru alerta cu prag de preț este necesar targetPrice > 0.'
      });
    }
  });

export const priceAlertUpdateSchema = z
  .object({
    alertType: priceAlertTypeSchema.optional(),
    targetPrice: z.coerce.number().min(0.01, 'Prețul țintă trebuie să fie > 0.').max(50000).optional(),
    intervalDays: priceHistoryIntervalSchema.nullable().optional(),
    isActive: z.boolean().optional()
  })
  .refine(
    val =>
      val.alertType !== undefined ||
      val.targetPrice !== undefined ||
      val.intervalDays !== undefined ||
      val.isActive !== undefined,
    { message: 'Trebuie furnizat cel puțin un câmp pentru actualizare.' }
  );

export const priceAlertsFromListSchema = z.object({
  alertType: priceAlertTypeSchema.default('below_target'),
  intervalDays: priceHistoryIntervalSchema.optional(),
  discountPercentForTarget: z.coerce.number().min(1).max(80).default(10)
});

// =========================================================================
// V2 Personal Assistant Validation Schemas
// =========================================================================

export const budgetSettingsUpdateSchema = z
  .object({
    monthlyBudget: z.coerce.number().min(0, 'Bugetul lunar nu poate fi negativ.').max(1000000).nullable().optional(),
    weeklyBudget: z.coerce.number().min(0, 'Bugetul săptămânal nu poate fi negativ.').max(250000).nullable().optional(),
    alertThresholdPct: z.coerce.number().int().min(10).max(100).optional()
  })
  .refine(
    val =>
      val.monthlyBudget !== undefined ||
      val.weeklyBudget !== undefined ||
      val.alertThresholdPct !== undefined,
    { message: 'Trebuie specificat cel puțin un parametru de buget.' }
  );

export const sharedListRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const sharedListInviteRoleSchema = z.enum(['editor', 'viewer']);

export const sharedListInviteCreateSchema = z.object({
  role: sharedListInviteRoleSchema.default('editor'),
  invitedEmail: z.string().trim().email('Adresa de email pentru invitație este invalidă.').max(160).optional().nullable(),
  expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
  maxUses: z.coerce.number().int().min(1).max(25).default(5)
});

export const sharedListMemberRoleUpdateSchema = z.object({
  role: sharedListInviteRoleSchema
});

export const sharedListActivityCreateSchema = z.object({
  actionType: z.enum([
    'list_shared',
    'member_joined',
    'member_role_changed',
    'member_revoked',
    'item_added',
    'item_updated',
    'item_checked',
    'item_unchecked',
    'item_removed',
    'list_renamed'
  ]),
  targetName: z.string().trim().max(255).optional().nullable(),
  details: z.record(z.string(), z.any()).optional()
});

export const barcodeSuggestionCreateSchema = z.object({
  barcode: z
    .string()
    .trim()
    .transform(v => v.replace(/\D/g, ''))
    .refine(v => [8, 12, 13, 14].includes(v.length), {
      message: 'Codul de bare trebuie să conțină 8, 12, 13 sau 14 cifre (EAN/UPC).'
    }),
  proposedName: z.string().trim().min(2, 'Denumirea produsului este obligatorie.').max(200),
  proposedBrand: z.string().trim().max(120).optional().nullable(),
  category: z.enum([
    'Fructe și legume',
    'Lactate și ouă',
    'Carne și pește',
    'Panificație',
    'Băuturi',
    'Produse congelate',
    'Produse de bază',
    'Curățenie',
    'Igienă personală',
    'Alte produse'
  ]).default('Alte produse'),
  packageWeightOrVolume: z.coerce.number().positive().max(10000).optional().nullable(),
  packageUnit: z.enum(['buc', 'kg', 'g', 'l', 'ml', 'pachet']).optional().nullable(),
  observedStoreId: z.string().trim().max(64).optional().nullable(),
  observedPrice: z.coerce.number().positive('Prețul observat trebuie să fie > 0.').max(50000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

export const assistantQueryRequestSchema = z.object({
  prompt: z.string().trim().min(2, 'Întrebarea către asistent este prea scurtă.').max(800),
  intent: z
    .enum([
      'budget_basket',
      'optimize_list',
      'list_promos',
      'cheaper_alternatives',
      'meal_plan_days',
      'general_guidance'
    ])
    .optional(),
  budgetLei: z.coerce.number().positive().max(100000).optional(),
  days: z.coerce.number().int().min(1).max(14).optional(),
  listId: z.string().trim().max(120).optional(),
  selectedProductId: z.string().trim().max(64).optional(),
  items: z.array(basketItemInputSchema).max(200).optional(),
  useLoyaltyCards: z.boolean().default(true)
});

