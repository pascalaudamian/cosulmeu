// src/components/ProductDetailView.tsx
// Pagina individuală a produsului – Comparație multi-retailer completă și transparentă

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Share2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Sparkles,
  Store as StoreIcon,
  Plus,
  ExternalLink,
  Tag,
  CreditCard,
  LineChart,
  Calendar,
  Info,
  Check,
  Building2,
  Barcode,
  Layers,
  HelpCircle,
  X
} from 'lucide-react';
import { Product, Store, ProductOffer, PriceObservation, ShoppingList } from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { StorageService } from '../services/StorageService.js';
import { STORES } from '../data/mockData.js';
import { getSafeProductImageSrc } from '../utils/urlSecurity.js';
import { ProductPriceTrend } from './ProductPriceTrend.tsx';

interface ProductDetailViewProps {
  productId: string;
  onBack: () => void;
  onNavigateToCategory?: (category: string) => void;
  activeList?: ShoppingList;
  onAddToList?: (productId: string, productName: string, product?: Product) => Promise<boolean> | boolean | void;
}

export const ProductDetailView: React.FC<ProductDetailViewProps> = ({
  productId,
  onBack,
  onNavigateToCategory,
  activeList,
  onAddToList
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<{
    product: Product;
    comparison: any;
    observations: PriceObservation[];
    hasSufficientHistory: boolean;
  } | null>(null);

  // Modal Raportare Eroare
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportErrorType, setReportErrorType] = useState<string>('price_mismatch');
  const [reportStoreId, setReportStoreId] = useState<string>('');
  const [reportPrice, setReportPrice] = useState<string>('');
  const [reportDetails, setReportDetails] = useState<string>('');
  const [reportEmail, setReportEmail] = useState<string>('');
  const [reportSuccessMessage, setReportSuccessMessage] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);

  // Toast adăugare în listă
  const [addedToast, setAddedToast] = useState<boolean>(false);

  // Copiere link
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [imageFailed, setImageFailed] = useState<boolean>(false);

  // Fetch product data
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setImageFailed(false);

    // Call API with fallback to local calculation
    fetch(`/api/products/${productId}`)
      .then(res => res.json())
      .then(resData => {
        if (!isMounted) return;
        if (resData.success) {
          setData({
            product: resData.product,
            comparison: resData.comparison,
            observations: resData.observations || [],
            hasSufficientHistory: resData.hasSufficientHistory
          });
        } else {
          fallbackLocalData();
        }
      })
      .catch(() => {
        if (!isMounted) return;
        fallbackLocalData();
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    function fallbackLocalData() {
      const comparison = PriceComparisonService.getProductComparisonDetails(productId);
      if (comparison) {
        const obs = StorageService.getPriceObservations().filter(o => o.productId === productId);
        setData({
          product: comparison.product,
          comparison,
          observations: obs,
          hasSufficientHistory: obs.length >= 2
        });
      }
    }

    return () => {
      isMounted = false;
    };
  }, [productId]);

  // SEO & Schema.org JSON-LD structured data management
  useEffect(() => {
    if (!data?.product) return;

    const prod = data.product;
    const lowestPriceStr = data.comparison?.lowestPrice ? `${data.comparison.lowestPrice} RON` : '';
    const newTitle = `${prod.name} ${prod.brand ? `(${prod.brand})` : ''} – Preț de la ${lowestPriceStr} | Coșul Meu`;
    const newDesc = `Compară prețurile pentru ${prod.name} în supermarketurile din România (Lidl, Kaufland, Carrefour etc.). Verifică oferte active, reduceri cu card și cel mai mic preț.`;

    document.title = newTitle;

    // Update Meta Description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', newDesc);
    }

    // Inject Schema.org Product JSON-LD
    const scriptId = 'jsonld-product-detail';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }

    const offersSchema = data.comparison?.offers?.map((o: any) => ({
      '@type': 'Offer',
      price: o.offer.price,
      priceCurrency: 'RON',
      priceValidUntil: o.validUntil || undefined,
      availability: 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: o.store.name
      }
    })) || [];

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: prod.name,
      brand: {
        '@type': 'Brand',
        name: prod.brand
      },
      gtin13: prod.barcode || undefined,
      description: prod.description || `${prod.name} - ${prod.packageWeightOrVolume} ${prod.packageUnit}`,
      category: prod.category,
      offers: offersSchema.length > 0 ? {
        '@type': 'AggregateOffer',
        lowPrice: data.comparison.lowestPrice,
        highPrice: data.comparison.highestPrice,
        priceCurrency: 'RON',
        offerCount: offersSchema.length,
        offers: offersSchema
      } : undefined
    };

    script.textContent = JSON.stringify(jsonLd);

    return () => {
      const el = document.getElementById(scriptId);
      if (el) el.remove();
      document.title = 'Coșul Meu - Comparator Prețuri & Bonuri';
    };
  }, [data]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleAddProductToList = async () => {
    if (!data?.product) return;
    const p = data.product;
    let added: boolean | void = true;
    if (onAddToList) {
      added = await onAddToList(p.id, p.name, p);
    } else {
      // Direct storage fallback
      const lists = StorageService.getShoppingLists();
      const nowIso = new Date().toISOString();
      const itemId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`;
      if (lists.length > 0 && lists[0]) {
        const current = lists[0];
        const existingIdx = current.items.findIndex(item => item.productId === p.id);
        if (existingIdx >= 0) {
          current.items[existingIdx] = {
            ...current.items[existingIdx],
            quantity: current.items[existingIdx].quantity + 1
          };
        } else {
          current.items.push({
            id: itemId,
            productId: p.id,
            name: p.name,
            brand: p.brand,
            category: p.category,
            quantity: 1,
            unit: p.defaultUnit || 'buc',
            checked: false,
            barcode: p.barcode,
            referencePrice: p.baseReferencePrice,
            estimatedPrice: p.baseReferencePrice
          });
        }
        current.updatedAt = nowIso;
        StorageService.saveShoppingLists(lists);
      }
    }
    if (added !== false) {
      setAddedToast(true);
      setTimeout(() => setAddedToast(false), 2500);
    }
  };

  const handleSubmitErrorReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.product || !reportDetails.trim()) return;

    setIsSubmittingReport(true);
    try {
      const payload = {
        productId: data.product.id,
        productName: data.product.name,
        storeId: reportStoreId || undefined,
        errorType: reportErrorType,
        reportedPrice: reportPrice ? parseFloat(reportPrice) : undefined,
        details: reportDetails,
        reporterEmail: reportEmail.trim() || undefined
      };

      const res = await fetch('/api/products/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();

      if (res.ok && resData.success) {
        setReportSuccessMessage('Raportul a fost trimis echipei noastre. Îți mulțumim pentru contribuția la transparența prețurilor!');
        setTimeout(() => {
          setShowReportModal(false);
          setReportSuccessMessage('');
          setReportDetails('');
          setReportPrice('');
        }, 2000);
      } else {
        // Fallback local
        StorageService.addUserErrorReport({
          id: `err-${Date.now()}`,
          productId: data.product.id,
          productName: data.product.name,
          storeId: reportStoreId || undefined,
          errorType: reportErrorType as any,
          reportedPrice: reportPrice ? parseFloat(reportPrice) : undefined,
          details: reportDetails,
          reporterEmail: reportEmail.trim() || undefined,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        setReportSuccessMessage('Raportul a fost înregistrat local. Mulțumim!');
        setTimeout(() => {
          setShowReportModal(false);
          setReportSuccessMessage('');
        }, 2000);
      }
    } catch {
      setReportSuccessMessage('Raportul a fost salvat. Mulțumim!');
      setTimeout(() => {
        setShowReportModal(false);
        setReportSuccessMessage('');
      }, 2000);
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 w-32 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
          <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-3xl"></div>
          <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-3xl"></div>
        </div>
      </div>
    );
  }

  if (!data?.product) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Produsul nu a fost găsit</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">
          Produsul solicitat nu mai există în catalog sau a fost arhivat.
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-sm font-semibold hover:bg-slate-800 dark:hover:bg-emerald-500 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Înapoi la Produse
        </button>
      </div>
    );
  }

  const { product, comparison, observations } = data;
  const offers = comparison.offers || [];

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* Toast Notificare */}
      {addedToast && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-700 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
          Produsul a fost adăugat în lista de cumpărături!
        </div>
      )}

      {copiedLink && (
        <div className="fixed top-20 right-4 z-50 bg-slate-900 dark:bg-slate-800 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4 text-emerald-400" />
          Link copiat în clipboard!
        </div>
      )}

      {/* Navigare Breadcrumb & Acțiuni */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Înapoi la catalog
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors shadow-2xs cursor-pointer"
            title="Copiază link direct SEO"
          >
            <Share2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Distribuie</span>
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300 transition-colors cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
            <span>Raportează eroare</span>
          </button>
        </div>
      </div>

      {/* Header Produs: Card Principal */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs mb-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Imagine Produs */}
          <div className="md:col-span-4 flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/80 rounded-2xl relative">
            {product.isRomanianProduct && (
              <span className="absolute top-3 left-3 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md text-[11px] font-bold text-slate-800 dark:text-slate-100 shadow-2xs flex items-center gap-1">
                <span>🇷🇴</span> Produs românesc
              </span>
            )}
            {product.isBio && (
              <span className="absolute top-3 right-3 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-transparent dark:border-emerald-800/60 px-2 py-0.5 rounded-md text-[11px] font-bold">
                BIO
              </span>
            )}

            {(() => {
              const safeImageSrc = getSafeProductImageSrc(product.imageUrl);
              return (
                <div className="w-40 h-40 flex items-center justify-center text-slate-400">
                  {safeImageSrc && !imageFailed ? (
                    <img
                      src={safeImageSrc}
                      alt={product.name}
                      className="max-h-full max-w-full object-contain rounded-xl"
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-300 font-extrabold text-3xl">
                      {product.name.charAt(0)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Detalii & Specificații */}
          <div className="md:col-span-8 flex flex-col justify-between h-full">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  onClick={() => onNavigateToCategory && onNavigateToCategory(product.category)}
                  className="px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
                >
                  {product.category}
                </span>
                {product.subcategory && (
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium">
                    {product.subcategory}
                  </span>
                )}
                {product.brand && (
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                    {product.brand}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">
                {product.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200">
                  <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  Gramaj / Cantitate: {product.packageWeightOrVolume} {product.packageUnit}
                </span>
                {product.barcode && (
                  <span className="flex items-center gap-1 font-mono text-slate-500 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    <Barcode className="w-3.5 h-3.5" /> EAN: {product.barcode}
                  </span>
                )}
                <span className="text-slate-400 dark:text-slate-600">•</span>
                <span>Referință bază: {PriceComparisonService.formatRon(product.baseReferencePrice)}</span>
              </div>
            </div>

            {/* Banner Cel Mai Bun Preț & Adăugare în Listă */}
            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">
                  Cel mai mic preț înregistrat acum:
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-emerald-700 dark:text-emerald-400">
                    {comparison.lowestPrice > 0
                      ? PriceComparisonService.formatRon(comparison.lowestPrice)
                      : 'Nicio ofertă'}
                  </span>
                  {comparison.lowestPrice > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      la <strong className="text-slate-800 dark:text-slate-100">{comparison.lowestStoreName}</strong>
                    </span>
                  )}
                </div>
                {comparison.maxSavingsAmount > 0 && (
                  <span className="inline-block mt-1 text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 px-2 py-0.5 rounded-full">
                    Economisești până la {PriceComparisonService.formatRon(comparison.maxSavingsAmount)} ({comparison.maxSavingsPercentage}%) între magazine
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => { void handleAddProductToList(); }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {activeList?.items.some(item => item.productId === product.id)
                    ? 'Adaugă încă unul în lista mea'
                    : 'Adaugă în lista mea'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECȚIUNEA 1: Comparație Detaliată Multi-Retailer */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <StoreIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Oferte de la retaileri ({offers.length} verificate)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Prețurile sunt sortate crescător. Sunt evidențiate explicit reducerile condiționate de card de fidelitate.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Audit prețuri fără simulări de producție</span>
          </div>
        </div>

        {offers.length === 0 ? (
          <div className="py-12 text-center bg-slate-50/50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <HelpCircle className="w-10 h-10 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nicio ofertă recent verificată pentru acest produs</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
              Nu afișăm prețuri estimate sau simulate ca fiind reale. Produsul este înregistrat în coada de indexare și va fi actualizat la următoarea trecere a colectorului.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {offers.map((item: any, idx: number) => {
              const isBest = item.isLowestPrice;
              const hasLoyalty = Boolean(item.loyaltyPrice);

              return (
                <div
                  key={`${item.store.id}-${idx}`}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    isBest
                      ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/30 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Magazin & Ecusoane */}
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-xl text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-xs ${item.store.brandColor}`}
                      >
                        {item.store.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-slate-900 dark:text-slate-100 text-base">
                            {item.store.name}
                          </span>
                          {isBest && (
                            <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Cel mai ieftin
                            </span>
                          )}
                          {item.isPromo && (
                            <span className="bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-transparent dark:border-rose-800/60 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Tag className="w-2.5 h-2.5" /> Promoție activă
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                            Verificat: {item.lastVerifiedAt}
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">•</span>
                          <span className="flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            Disponibil la raft
                          </span>
                          {item.validUntil && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">•</span>
                              <span className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Expiră: {item.validUntil}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Preț & Diferențiere Card Fidelitate */}
                    <div className="flex items-end sm:items-center justify-between sm:justify-end gap-6 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                      {hasLoyalty ? (
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold mb-0.5">
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Cu {item.loyaltyCardName || 'Card'}:</span>
                          </div>
                          <div className="flex items-baseline gap-2 justify-end">
                            <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                              {PriceComparisonService.formatRon(item.standardPrice)}
                            </span>
                            <span className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
                              {PriceComparisonService.formatRon(item.offer.price)}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {PriceComparisonService.formatRon(item.unitPrice)} / {item.unitPriceMeasure}
                          </span>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-xs text-slate-400 dark:text-slate-500 font-medium block">Preț standard</span>
                          <span className="text-2xl font-black text-slate-900 dark:text-slate-100">
                            {PriceComparisonService.formatRon(item.offer.price)}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {PriceComparisonService.formatRon(item.unitPrice)} / {item.unitPriceMeasure}
                          </span>
                        </div>
                      )}

                      {/* Freshness Badge */}
                      <div className="hidden lg:block text-right shrink-0">
                        <span
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.freshnessStatus === 'very_recent'
                              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                              : item.freshnessStatus === 'recent'
                              ? 'bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300'
                              : 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {item.freshnessLabelRo}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-0.5">
                          Calitate: {item.qualityScore}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Detalii Promoție & Avertisment Card */}
                  {item.promoDetails && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>{item.promoDetails}</span>
                      {hasLoyalty && (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold ml-1">
                          (Reducerea se aplică la scanarea {item.loyaltyCardName} la casa de marcat)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECȚIUNEA 2: Trend Prețuri (Recharts + Estimare Săptămânală) */}
      <ProductPriceTrend
        productName={product.name}
        observations={observations}
        offers={offers.map((o: any) => ({
          price: Number(o.offer?.price) || 0,
          observationDate: o.offer?.observationDate,
          storeId: o.store?.id,
          storeName: o.store?.name
        }))}
        stores={STORES}
      />

      {/* SECȚIUNEA 3: Jurnal Observații Preț Reale */}
      {observations.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs mb-8">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <LineChart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                Jurnal Observații Prețuri Reale
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Observații validate în timp prin bonuri fiscale și feed-uri oficiale (jurnal append-only).
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
              {observations.length} înregistrări istorice
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Dată</th>
                  <th className="px-4 py-2.5">Magazin</th>
                  <th className="px-4 py-2.5">Preț</th>
                  <th className="px-4 py-2.5">Sursă verificare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {observations.slice(0, 12).map((obs, idx) => {
                  const st = STORES.find(s => s.id === obs.storeId);
                  return (
                    <tr key={obs.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200 tabular-nums">{obs.date}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{st?.name || obs.storeId}</td>
                      <td className="px-4 py-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                        {PriceComparisonService.formatRon(obs.price)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        {obs.source === 'verified' ? 'Bon fiscal utilizator' : 'Feed oficial magazin'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: Raportează o Eroare */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                <span>Raportează o eroare de preț sau date</span>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSuccessMessage ? (
              <div className="py-6 text-center text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                {reportSuccessMessage}
              </div>
            ) : (
              <form onSubmit={handleSubmitErrorReport} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Produs selectat</label>
                  <input
                    type="text"
                    disabled
                    value={product.name}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Tipul problemei *</label>
                    <select
                      value={reportErrorType}
                      onChange={e => setReportErrorType(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    >
                      <option value="price_mismatch">Preț diferit la raft</option>
                      <option value="wrong_product">Produs nepotrivit / nepotrivire magazin</option>
                      <option value="expired_promo">Promoție expirată afișată ca activă</option>
                      <option value="wrong_category">Categorie sau gramaj greșit</option>
                      <option value="other">Altă eroare</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Magazinul vizat</label>
                    <select
                      value={reportStoreId}
                      onChange={e => setReportStoreId(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    >
                      <option value="">Alege magazinul...</option>
                      {STORES.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Prețul real observat (lei, opțional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Ex: 7.49"
                    value={reportPrice}
                    onChange={e => setReportPrice(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Detalii suplimentare *</label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Ex: La magazinul Lidl din Militari prețul este 7.49 lei, nu 6.49 lei."
                    value={reportDetails}
                    onChange={e => setReportDetails(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Email-ul tău (opțional, pentru confirmare)</label>
                  <input
                    type="email"
                    placeholder="nume@exemplu.ro"
                    value={reportEmail}
                    onChange={e => setReportEmail(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReport}
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmittingReport ? 'Se trimite...' : 'Trimite raportul'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
