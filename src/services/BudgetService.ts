import {
  BudgetAlertLevel,
  BudgetStatusSummary,
  CategorySpendingSummary,
  MonthlySpendingHistoryEntry,
  PersonalBudgetSettings,
  Product,
  ProductCategory,
  Receipt
} from '../types.js';
import { mapRetailerCategoryToStandard } from '../data/categories.js';

const MONTHS_RO = [
  'Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun',
  'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMondayAndSundayIsoWeek(refDate: Date): { startIso: string; endIso: string; labelRo: string } {
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startIso = toIsoDate(monday);
  const endIso = toIsoDate(sunday);
  const labelRo = `${monday.getDate()} ${MONTHS_RO[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS_RO[sunday.getMonth()]}`;
  return { startIso, endIso, labelRo };
}

function resolveReceiptDateIso(receipt: Receipt): string | null {
  const raw = (receipt.date || receipt.createdAt || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIsoDate(parsed);
}

/**
 * Determină dacă un bon fiscal poate fi contabilizat ca cheltuială confirmată.
 * Bonurile draft, invalide, eșuate sau cu total nevalid NU sunt niciodată incluse.
 */
export function isConfirmedValidReceiptForBudget(receipt: Receipt): boolean {
  if (!receipt) return false;
  if (receipt.verifiedStatus !== 'confirmed') return false;
  if (receipt.validationStatus === 'INVALID') return false;
  const rawStatus = (receipt as unknown as { status?: string }).status;
  if (rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'rejected') return false;
  if (!Number.isFinite(receipt.total) || receipt.total <= 0) return false;
  if (!resolveReceiptDateIso(receipt)) return false;
  return true;
}

function evaluateAlertLevel(
  spent: number,
  budgetLimit: number | null | undefined,
  thresholdPct: number
): { progressPct: number | null; remaining: number | null; level: BudgetAlertLevel } {
  if (budgetLimit === null || budgetLimit === undefined || !Number.isFinite(budgetLimit) || budgetLimit <= 0) {
    return { progressPct: null, remaining: null, level: 'unconfigured' };
  }
  const progressPct = round2((spent / budgetLimit) * 100);
  const remaining = round2(budgetLimit - spent);
  if (spent > budgetLimit) {
    return { progressPct, remaining, level: 'exceeded' };
  }
  if (progressPct >= thresholdPct) {
    return { progressPct, remaining, level: 'warning' };
  }
  return { progressPct, remaining, level: 'none' };
}

function resolveItemCategory(
  rawName: string,
  explicitCategory: string | undefined,
  matchedProductId: string | undefined,
  productCategoryMap: Map<string, ProductCategory>
): string {
  if (explicitCategory && explicitCategory !== 'Alte produse') {
    return explicitCategory;
  }
  if (matchedProductId && productCategoryMap.has(matchedProductId)) {
    return productCategoryMap.get(matchedProductId)!;
  }
  if (explicitCategory) {
    return explicitCategory;
  }
  return mapRetailerCategoryToStandard(rawName).category || 'Alte produse';
}

export class BudgetService {
  static isConfirmedValidReceipt = isConfirmedValidReceiptForBudget;

  static calculateSummary(params: {
    receipts: Receipt[];
    settings?: Partial<PersonalBudgetSettings> | null;
    catalogProducts?: Product[];
    referenceDate?: Date;
  }): BudgetStatusSummary {
    const now = params.referenceDate ? new Date(params.referenceDate) : new Date();
    const thresholdPct = Math.min(
      100,
      Math.max(10, Number(params.settings?.alertThresholdPct ?? 80) || 80)
    );
    const monthlyBudget =
      params.settings?.monthlyBudget != null &&
      Number.isFinite(Number(params.settings.monthlyBudget)) &&
      Number(params.settings.monthlyBudget) > 0
        ? round2(Number(params.settings.monthlyBudget))
        : null;
    const weeklyBudget =
      params.settings?.weeklyBudget != null &&
      Number.isFinite(Number(params.settings.weeklyBudget)) &&
      Number(params.settings.weeklyBudget) > 0
        ? round2(Number(params.settings.weeklyBudget))
        : null;

    const settings: PersonalBudgetSettings = {
      monthlyBudget,
      weeklyBudget,
      alertThresholdPct: thresholdPct
    };

    const productCategoryMap = new Map<string, ProductCategory>();
    for (const p of params.catalogProducts || []) {
      if (p?.id && p?.category) {
        productCategoryMap.set(p.id, p.category);
      }
    }

    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentWeek = getMondayAndSundayIsoWeek(now);

    // Pre-seed last 6 months for deterministic monthly history
    const monthBuckets = new Map<string, { labelRo: string; totalSpent: number; receiptsCount: number }>();
    for (let offset = 5; offset >= 0; offset--) {
      const mDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const mKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, '0')}`;
      const labelRo = `${MONTHS_RO[mDate.getMonth()]} ${mDate.getFullYear()}`;
      monthBuckets.set(mKey, { labelRo, totalSpent: 0, receiptsCount: 0 });
    }

    let monthlySpent = 0;
    let weeklySpent = 0;
    let confirmedReceiptsCount = 0;
    let excludedReceiptsCount = 0;

    const categoryTotals = new Map<string, { amount: number; itemsCount: number }>();

    const addCategoryAmount = (category: string, amount: number, itemCount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const existing = categoryTotals.get(category) || { amount: 0, itemsCount: 0 };
      existing.amount = round2(existing.amount + amount);
      existing.itemsCount += itemCount;
      categoryTotals.set(category, existing);
    };

    for (const receipt of params.receipts || []) {
      if (!isConfirmedValidReceiptForBudget(receipt)) {
        excludedReceiptsCount += 1;
        continue;
      }

      const dateIso = resolveReceiptDateIso(receipt)!;
      const monthKey = dateIso.slice(0, 7);
      const receiptTotal = round2(Number(receipt.total));
      confirmedReceiptsCount += 1;

      const existingMonth = monthBuckets.get(monthKey);
      if (existingMonth) {
        existingMonth.totalSpent = round2(existingMonth.totalSpent + receiptTotal);
        existingMonth.receiptsCount += 1;
      } else {
        const [yStr, mStr] = monthKey.split('-');
        const mIdx = Math.max(0, Math.min(11, Number(mStr) - 1));
        monthBuckets.set(monthKey, {
          labelRo: `${MONTHS_RO[mIdx]} ${yStr}`,
          totalSpent: receiptTotal,
          receiptsCount: 1
        });
      }

      if (dateIso >= currentWeek.startIso && dateIso <= currentWeek.endIso) {
        weeklySpent = round2(weeklySpent + receiptTotal);
      }

      if (monthKey === currentMonthKey) {
        monthlySpent = round2(monthlySpent + receiptTotal);

        const validItems = (receipt.items || []).filter(
          it => !it.isCouponOrDiscountLine && Number.isFinite(it.totalPrice) && it.totalPrice > 0
        );
        if (validItems.length === 0) {
          addCategoryAmount('Alte produse', receiptTotal, Math.max(1, (receipt.items || []).length));
        } else {
          const itemsNetSum = validItems.reduce((sum, it) => {
            const net = Math.max(0, Number(it.totalPrice) - Math.max(0, Number(it.discount || 0)));
            return sum + net;
          }, 0);

          if (itemsNetSum > 0) {
            const scale = receiptTotal / itemsNetSum;
            for (const item of validItems) {
              const net = Math.max(0, Number(item.totalPrice) - Math.max(0, Number(item.discount || 0)));
              const attributed = round2(net * scale);
              const cat = resolveItemCategory(
                item.rawName,
                item.category,
                item.matchedProductId,
                productCategoryMap
              );
              addCategoryAmount(cat, attributed, 1);
            }
          } else {
            addCategoryAmount('Alte produse', receiptTotal, validItems.length);
          }
        }
      }
    }

    const totalCategorized = Array.from(categoryTotals.values()).reduce((s, c) => s + c.amount, 0);
    const categoryBreakdown: CategorySpendingSummary[] = Array.from(categoryTotals.entries())
      .map(([category, info]) => ({
        category,
        amount: round2(info.amount),
        sharePct: totalCategorized > 0 ? round2((info.amount / totalCategorized) * 100) : 0,
        itemsCount: info.itemsCount
      }))
      .sort((a, b) => b.amount - a.amount);

    const monthlyEval = evaluateAlertLevel(monthlySpent, monthlyBudget, thresholdPct);
    const weeklyEval = evaluateAlertLevel(weeklySpent, weeklyBudget, thresholdPct);

    const warningsRo: string[] = [];
    if (monthlyEval.level === 'exceeded' && monthlyBudget !== null) {
      warningsRo.push(
        `Ai depășit bugetul lunar cu ${round2(monthlySpent - monthlyBudget).toFixed(2)} lei (${monthlyEval.progressPct}% din ${monthlyBudget.toFixed(2)} lei).`
      );
    } else if (monthlyEval.level === 'warning' && monthlyBudget !== null) {
      warningsRo.push(
        `Atenție: ai consumat ${monthlyEval.progressPct}% din bugetul lunar (prag configurat: ${thresholdPct}%).`
      );
    }

    if (weeklyEval.level === 'exceeded' && weeklyBudget !== null) {
      warningsRo.push(
        `Ai depășit bugetul săptămânal cu ${round2(weeklySpent - weeklyBudget).toFixed(2)} lei (${weeklyEval.progressPct}% din ${weeklyBudget.toFixed(2)} lei).`
      );
    } else if (weeklyEval.level === 'warning' && weeklyBudget !== null) {
      warningsRo.push(
        `Atenție: ai consumat ${weeklyEval.progressPct}% din bugetul săptămânal (prag configurat: ${thresholdPct}%).`
      );
    }

    const monthlyHistory: MonthlySpendingHistoryEntry[] = Array.from(monthBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([monthKey, val]) => ({
        monthKey,
        labelRo: val.labelRo,
        totalSpent: round2(val.totalSpent),
        receiptsCount: val.receiptsCount,
        budgetTarget: monthlyBudget,
        overBudget: monthlyBudget !== null && val.totalSpent > monthlyBudget
      }));

    return {
      settings,
      currentMonthKey,
      currentWeekRangeLabel: currentWeek.labelRo,
      monthlySpent,
      weeklySpent,
      monthlyRemaining: monthlyEval.remaining,
      weeklyRemaining: weeklyEval.remaining,
      monthlyProgressPct: monthlyEval.progressPct,
      weeklyProgressPct: weeklyEval.progressPct,
      monthlyAlertLevel: monthlyEval.level,
      weeklyAlertLevel: weeklyEval.level,
      confirmedReceiptsCount,
      excludedReceiptsCount,
      categoryBreakdown,
      monthlyHistory,
      warningsRo
    };
  }
}
