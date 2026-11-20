import React, { useMemo, useState, useEffect } from 'react';
import {
  Wallet,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  PieChart as PieChartIcon,
  Save,
  ShieldCheck,
  Info
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell
} from 'recharts';
import { PersonalBudgetSettings, Product, Receipt } from '../types.js';
import { BudgetService } from '../services/BudgetService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';

interface PersonalBudgetSectionProps {
  receipts: Receipt[];
  catalogProducts: Product[];
  initialSettings: PersonalBudgetSettings;
  isAuthenticated: boolean;
  accessToken?: string;
  onSaveSettings: (next: PersonalBudgetSettings) => void | Promise<void>;
}

export const PersonalBudgetSection: React.FC<PersonalBudgetSectionProps> = ({
  receipts,
  catalogProducts,
  initialSettings,
  isAuthenticated,
  accessToken,
  onSaveSettings
}) => {
  const [monthlyInput, setMonthlyInput] = useState<string>(
    initialSettings.monthlyBudget != null ? String(initialSettings.monthlyBudget) : ''
  );
  const [weeklyInput, setWeeklyInput] = useState<string>(
    initialSettings.weeklyBudget != null ? String(initialSettings.weeklyBudget) : ''
  );
  const [thresholdPct, setThresholdPct] = useState<number>(initialSettings.alertThresholdPct || 80);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setMonthlyInput(initialSettings.monthlyBudget != null ? String(initialSettings.monthlyBudget) : '');
    setWeeklyInput(initialSettings.weeklyBudget != null ? String(initialSettings.weeklyBudget) : '');
    setThresholdPct(initialSettings.alertThresholdPct || 80);
  }, [initialSettings.monthlyBudget, initialSettings.weeklyBudget, initialSettings.alertThresholdPct]);

  const parsedSettings: PersonalBudgetSettings = useMemo(() => {
    const m = monthlyInput.trim() === '' ? null : Math.max(0, Number(monthlyInput));
    const w = weeklyInput.trim() === '' ? null : Math.max(0, Number(weeklyInput));
    return {
      monthlyBudget: m !== null && Number.isFinite(m) && m > 0 ? m : null,
      weeklyBudget: w !== null && Number.isFinite(w) && w > 0 ? w : null,
      alertThresholdPct: Math.min(100, Math.max(10, Number(thresholdPct) || 80))
    };
  }, [monthlyInput, weeklyInput, thresholdPct]);

  const summary = useMemo(
    () =>
      BudgetService.calculateSummary({
        receipts,
        settings: parsedSettings,
        catalogProducts
      }),
    [receipts, parsedSettings, catalogProducts]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (isAuthenticated && accessToken) {
        const res = await fetch('/api/budget/settings', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify(parsedSettings)
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Nu am putut salva configurarea bugetului.');
        }
      }
      await onSaveSettings(parsedSettings);
      setFeedback({ type: 'ok', text: 'Setările de buget personal au fost salvate.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Eroare la salvarea bugetului.' });
    } finally {
      setSaving(false);
    }
  };

  const renderProgressBar = (pct: number | null, level: string) => {
    const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct));
    const colorClass =
      level === 'exceeded'
        ? 'bg-rose-600 dark:bg-rose-500'
        : level === 'warning'
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-emerald-600 dark:bg-emerald-500';
    return (
      <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Warning / Exceeded Alerts */}
      {summary.warningsRo.length > 0 && (
        <div
          role="alert"
          className={`rounded-2xl border p-4 space-y-1.5 ${
            summary.monthlyAlertLevel === 'exceeded' || summary.weeklyAlertLevel === 'exceeded'
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Avertizare prag buget</span>
          </div>
          {summary.warningsRo.map((w, idx) => (
            <p key={idx} className="text-xs leading-relaxed">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Top KPI Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Cheltuieli lunare ({summary.currentMonthKey})
              </span>
              <span className="font-display text-2xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
                {PriceComparisonService.formatRon(summary.monthlySpent)}
              </span>
            </div>
            {summary.settings.monthlyBudget && (
              <div className="text-right tabular-nums">
                <span className="text-xs text-slate-500 dark:text-slate-400 block">Buget lunar</span>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {PriceComparisonService.formatRon(summary.settings.monthlyBudget)}
                </span>
              </div>
            )}
          </div>
          {summary.settings.monthlyBudget ? (
            <>
              {renderProgressBar(summary.monthlyProgressPct, summary.monthlyAlertLevel)}
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {summary.monthlyProgressPct}% consumat
                </span>
                <span
                  className={
                    (summary.monthlyRemaining ?? 0) < 0
                      ? 'font-bold text-rose-600 dark:text-rose-400'
                      : 'font-semibold text-emerald-700 dark:text-emerald-400'
                  }
                >
                  {(summary.monthlyRemaining ?? 0) < 0
                    ? `Depășire: ${PriceComparisonService.formatRon(Math.abs(summary.monthlyRemaining ?? 0))}`
                    : `Disponibil: ${PriceComparisonService.formatRon(summary.monthlyRemaining ?? 0)}`}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configurează mai jos un plafon lunar pentru a urmări progresul și avertizările.
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Cheltuieli săptămânale ({summary.currentWeekRangeLabel})
              </span>
              <span className="font-display text-2xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
                {PriceComparisonService.formatRon(summary.weeklySpent)}
              </span>
            </div>
            {summary.settings.weeklyBudget && (
              <div className="text-right tabular-nums">
                <span className="text-xs text-slate-500 dark:text-slate-400 block">Buget săptămânal</span>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {PriceComparisonService.formatRon(summary.settings.weeklyBudget)}
                </span>
              </div>
            )}
          </div>
          {summary.settings.weeklyBudget ? (
            <>
              {renderProgressBar(summary.weeklyProgressPct, summary.weeklyAlertLevel)}
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {summary.weeklyProgressPct}% consumat
                </span>
                <span
                  className={
                    (summary.weeklyRemaining ?? 0) < 0
                      ? 'font-bold text-rose-600 dark:text-rose-400'
                      : 'font-semibold text-emerald-700 dark:text-emerald-400'
                  }
                >
                  {(summary.weeklyRemaining ?? 0) < 0
                    ? `Depășire: ${PriceComparisonService.formatRon(Math.abs(summary.weeklyRemaining ?? 0))}`
                    : `Disponibil: ${PriceComparisonService.formatRon(summary.weeklyRemaining ?? 0)}`}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configurează un buget săptămânal pentru control fin al cumpărăturilor recurente.
            </p>
          )}
        </div>
      </div>

      {/* Confirmed vs Excluded Receipt Integrity Notice */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>
            Calcul realizat exclusiv din{' '}
            <strong className="text-slate-900 dark:text-slate-100 tabular-nums">
              {summary.confirmedReceiptsCount} bonuri confirmate și validate
            </strong>
            .
          </span>
        </div>
        {summary.excludedReceiptsCount > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold tabular-nums">
            <Info className="w-3.5 h-3.5" />
            {summary.excludedReceiptsCount} bon(uri) ciornă / cu erori excluse
          </span>
        )}
      </div>

      {/* Configure Budget Form */}
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
            Configurare Buget Personal
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
              Buget lunar (lei)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="ex: 1800"
              value={monthlyInput}
              onChange={e => setMonthlyInput(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden tabular-nums"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
              Buget săptămânal (lei)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="ex: 450"
              value={weeklyInput}
              onChange={e => setWeeklyInput(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden tabular-nums"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
              Prag avertizare ({thresholdPct}%)
            </label>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={thresholdPct}
              onChange={e => setThresholdPct(Number(e.target.value))}
              className="w-full accent-emerald-600 mt-2 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
              <span>50%</span>
              <span>80%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Se salvează...' : 'Salvează bugetul'}</span>
          </button>
        </div>
      </form>

      {/* Spending Breakdown by Category + 6-Month History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
            <PieChartIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
              Cheltuieli pe categorii (luna curentă)
            </h3>
          </div>

          {summary.categoryBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
              Nu există încă cheltuieli confirmate din bonuri fiscale pentru luna curentă.
            </p>
          ) : (
            <div className="space-y-3">
              {summary.categoryBreakdown.map(cat => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {cat.category}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 shrink-0">
                      {PriceComparisonService.formatRon(cat.amount)} · {cat.sharePct}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                      style={{ width: `${Math.min(100, cat.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
              Istoric lunar cheltuieli (6 luni)
            </h3>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.monthlyHistory} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.35} />
                <XAxis dataKey="labelRo" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip
                  formatter={(value: any) => [
                    PriceComparisonService.formatRon(Number(value) || 0),
                    'Total confirmat'
                  ]}
                />
                <Bar dataKey="totalSpent" radius={[8, 8, 0, 0]}>
                  {summary.monthlyHistory.map(entry => (
                    <Cell
                      key={entry.monthKey}
                      fill={entry.overBudget ? '#e11d48' : '#059669'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
