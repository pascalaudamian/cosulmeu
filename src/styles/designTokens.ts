import type { PriceDataQualityStatus } from '../types.js';

export const DESIGN_BREAKPOINTS = {
  mobileXs: 320,
  mobileSm: 375,
  mobileMd: 390,
  mobileLg: 430,
  tablet: 768,
  desktop: 1024,
  desktopWide: 1440
} as const;

export const DESIGN_TYPOGRAPHY = {
  pageTitle: 'font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50',
  sectionTitle: 'font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100',
  cardTitle: 'font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100',
  body: 'text-sm text-slate-600 dark:text-slate-300 leading-relaxed',
  caption: 'text-xs text-slate-500 dark:text-slate-400',
  overline: 'text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400',
  priceHero: 'font-display text-2xl sm:text-3xl font-extrabold tabular-nums text-slate-900 dark:text-slate-50',
  priceRegular: 'font-display font-bold tabular-nums text-slate-900 dark:text-slate-100'
} as const;

export const DESIGN_SURFACE_CLASSES = {
  card: 'surface-card rounded-2xl',
  cardPadded: 'surface-card rounded-2xl p-4 sm:p-6',
  cardCompact: 'surface-card rounded-2xl p-3.5 sm:p-4',
  subtleBox: 'rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800',
  modalPanel:
    'w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6'
} as const;

export const DESIGN_CONTROL_CLASSES = {
  btnPrimary: 'ds-btn ds-btn-primary',
  btnSecondary: 'ds-btn ds-btn-secondary',
  btnDanger: 'ds-btn ds-btn-danger',
  btnGhost: 'ds-btn ds-btn-ghost',
  input: 'ds-input',
  label: 'ds-label'
} as const;

export interface QualityStatusDisplayToken {
  status: PriceDataQualityStatus;
  labelRo: string;
  shortDescRo: string;
  badgeClass: string;
  textClass: string;
  dotClass: string;
  iconName: 'shield-check' | 'check-circle' | 'clock' | 'help-circle' | 'calendar-x' | 'alert-triangle';
}

export const QUALITY_STATUS_DISPLAY_TOKENS: Record<PriceDataQualityStatus, QualityStatusDisplayToken> = {
  VERIFIED_RECENTLY: {
    status: 'VERIFIED_RECENTLY',
    labelRo: 'Verificat recent',
    shortDescRo: 'Preț verificat pe baza unei observații recente din ultimele zile.',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    dotClass: 'bg-emerald-600 dark:bg-emerald-400',
    iconName: 'shield-check'
  },
  VERIFIED: {
    status: 'VERIFIED',
    labelRo: 'Verificat',
    shortDescRo: 'Preț susținut de o sursă validă și consecvent cu istoricul produsului.',
    badgeClass:
      'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    textClass: 'text-sky-700 dark:text-sky-400',
    dotClass: 'bg-sky-600 dark:bg-sky-400',
    iconName: 'check-circle'
  },
  STALE: {
    status: 'STALE',
    labelRo: 'Date învechite',
    shortDescRo: 'Ultima verificare depășește intervalul recomandat; prețul la raft se poate fi schimbat.',
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    textClass: 'text-amber-700 dark:text-amber-400',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    iconName: 'clock'
  },
  UNVERIFIED: {
    status: 'UNVERIFIED',
    labelRo: 'Neverificat',
    shortDescRo: 'Informație insuficient susținută de surse verificate sau bonuri confirmate.',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    textClass: 'text-slate-600 dark:text-slate-300',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
    iconName: 'help-circle'
  },
  EXPIRED: {
    status: 'EXPIRED',
    labelRo: 'Expirat',
    shortDescRo: 'Oferta promoțională sau observația de preț a depășit perioada de valabilitate.',
    badgeClass:
      'bg-orange-50 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800',
    textClass: 'text-orange-700 dark:text-orange-400',
    dotClass: 'bg-orange-500 dark:bg-orange-400',
    iconName: 'calendar-x'
  },
  SUSPICIOUS: {
    status: 'SUSPICIOUS',
    labelRo: 'Suspect',
    shortDescRo: 'Anomalie de preț, unitate, monedă sau inconsistență față de istoricul produsului.',
    badgeClass:
      'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    textClass: 'text-rose-700 dark:text-rose-400',
    dotClass: 'bg-rose-600 dark:bg-rose-400',
    iconName: 'alert-triangle'
  }
};

export function getQualityStatusDisplay(status?: PriceDataQualityStatus | null): QualityStatusDisplayToken {
  if (!status || !(status in QUALITY_STATUS_DISPLAY_TOKENS)) {
    return QUALITY_STATUS_DISPLAY_TOKENS.UNVERIFIED;
  }
  return QUALITY_STATUS_DISPLAY_TOKENS[status];
}
