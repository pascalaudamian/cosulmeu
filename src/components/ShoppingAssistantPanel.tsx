import React, { useState } from 'react';
import {
  Bot,
  Check,
  Info,
  Plus,
  Send,
  Sparkles,
  Tag,
  AlertTriangle,
  X
} from 'lucide-react';
import {
  Product,
  ShoppingAssistantGroundedItem,
  ShoppingAssistantResponse,
  ShoppingList
} from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';

interface ShoppingAssistantPanelProps {
  open: boolean;
  onClose: () => void;
  activeList: ShoppingList;
  catalogProducts: Product[];
  accessToken?: string;
  useLoyaltyCards?: boolean;
  onAddProductToList: (productId: string, productName: string, productData?: Product) => Promise<boolean> | void;
}

const QUICK_PROMPTS = [
  'Ce pot cumpăra cu 200 lei?',
  'Optimizează lista mea.',
  'Ce produse din lista mea sunt la reducere?',
  'Găsește alternative mai ieftine.',
  'Planifică cumpărăturile pentru 5 zile.'
];

export const ShoppingAssistantPanel: React.FC<ShoppingAssistantPanelProps> = ({
  open,
  onClose,
  activeList,
  catalogProducts,
  accessToken,
  useLoyaltyCards = true,
  onAddProductToList
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [response, setResponse] = useState<ShoppingAssistantResponse | null>(null);
  const [deterministicFallback, setDeterministicFallback] = useState<any | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const runQuery = async (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed) return;
    setPrompt(trimmed);
    setLoading(true);
    setErrorMsg(null);
    setDeterministicFallback(null);

    try {
      const res = await fetch('/api/assistant/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({
          prompt: trimmed,
          listId: activeList.id,
          items: activeList.items,
          useLoyaltyCards
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        if (data?.deterministicPlan) {
          setDeterministicFallback(data.deterministicPlan);
        }
        throw new Error(data?.error || 'Asistentul nu a putut genera răspunsul.');
      }
      setResponse(data as ShoppingAssistantResponse);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la comunicarea cu asistentul.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (item: ShoppingAssistantGroundedItem) => {
    const prod = catalogProducts.find(p => p.id === item.productId);
    await onAddProductToList(item.productId, item.productName, prod);
    setAddedIds(prev => {
      const next = new Set(prev);
      next.add(item.productId);
      return next;
    });
  };

  if (!open) return null;

  const displayItems: ShoppingAssistantGroundedItem[] =
    response?.recommendedItems || deterministicFallback?.items || [];
  const displayTotal: number =
    response?.totalEstimatedCost ?? deterministicFallback?.totalEstimatedCost ?? 0;
  const displayLimitations: string[] =
    response?.limitations || deterministicFallback?.limitations || [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200/90 dark:border-emerald-800/70 p-4 sm:p-6 shadow-md space-y-4">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Asistent Coșul Meu (V2)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Recomandări ancorate 100% în ofertele valide din catalog și lista ta activă
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map(qp => (
          <button
            key={qp}
            type="button"
            disabled={loading}
            onClick={() => { void runQuery(qp); }}
            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 hover:text-emerald-800 dark:hover:text-emerald-300 border border-slate-200/70 dark:border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Prompt Input */}
      <form
        onSubmit={e => {
          e.preventDefault();
          void runQuery(prompt);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Întreabă asistentul (ex: Ce pot cumpăra cu 150 lei?)..."
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:outline-hidden"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" />
          <span>{loading ? 'Analizez...' : 'Întreabă'}</span>
        </button>
      </form>

      {/* Honest AI / Service Error Notice */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          {deterministicFallback && (
            <p className="text-amber-800 dark:text-amber-300">
              Mai jos sunt afișate exclusiv calculele deterministe verificate din catalog (fără generare Gemini AI):
            </p>
          )}
        </div>
      )}

      {/* Grounded Answer + Items */}
      {(response || deterministicFallback) && (
        <div className="space-y-3 pt-2">
          {response && (
            <div className="rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  {response.generatedWithAi ? `Răspuns verificat · ${response.model}` : 'Calcul determinist verificat'}
                </span>
                <span className="tabular-nums">{response.groundedSourceCount} oferte verificate</span>
              </div>
              <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed font-medium">
                {response.answerRo}
              </p>
              {response.highlights.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 pt-1">
                  {response.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">•</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {displayItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                <span>Produse selectate din catalog ({displayItems.length})</span>
                <span>Total calculat: {PriceComparisonService.formatRon(displayTotal)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {displayItems.map(item => {
                  const isAdded = addedIds.has(item.productId);
                  return (
                    <div
                      key={`${item.productId}-${item.storeId}-${item.dayLabel || ''}`}
                      className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                            {item.storeName}
                          </span>
                          {item.dayLabel && <span>· {item.dayLabel}</span>}
                          {item.isPromo && (
                            <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400 font-bold">
                              · <Tag className="w-2.5 h-2.5" /> Promo
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {item.productName}
                        </p>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {PriceComparisonService.formatRon(item.price)}
                          </strong>{' '}
                          ({item.unitPrice.toFixed(2)} {item.unitPriceMeasure})
                          {item.noteRo && <span className="block truncate">{item.noteRo}</span>}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => { void handleAddItem(item); }}
                        className={`p-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-colors ${
                          isAdded
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                        title="Adaugă în lista activă"
                      >
                        {isAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {displayLimitations.length > 0 && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
              <div className="font-bold flex items-center gap-1 text-slate-700 dark:text-slate-300">
                <Info className="w-3.5 h-3.5" /> Limitări & Transparență date
              </div>
              {displayLimitations.map((lim, i) => (
                <p key={i}>• {lim}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
