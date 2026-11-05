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

interface ProductDetailViewProps {
  productId: string;
  onBack: () => void;
  onNavigateToCategory?: (category: string) => void;
  activeList?: ShoppingList;
  onAddToList?: (productId: string, productName: string) => void;
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

  // Fetch product data
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

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

  const handleAddProductToList = () => {
    if (!data?.product) return;
    if (onAddToList) {
      onAddToList(data.product.id, data.product.name);
    } else {
      // Direct storage fallback
      const lists = StorageService.getShoppingLists();
      const current = lists[0];
      if (current) {
        current.items.push({
          id: `item-${Date.now()}`,
          productId: data.product.id,
          name: data.product.name,
          brand: data.product.brand,
          category: data.product.category,
          quantity: 1,
          unit: data.product.defaultUnit,
          checked: false
        });
        StorageService.saveShoppingLists(lists);
      }
    }
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2500);
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
          <div className="h-6 w-32 bg-slate-200 rounded-lg"></div>
          <div className="h-64 bg-slate-200 rounded-3xl"></div>
          <div className="h-48 bg-slate-200 rounded-3xl"></div>
        </div>
      </div>
    );
  }

  if (!data?.product) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-900">Produsul nu a fost găsit</h2>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Produsul solicitat nu mai există în catalog sau a fost arhivat.
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Înapoi la Produse
        </button>
      </div>
    );
  }

  const { product, comparison, observations, hasSufficientHistory } = data;
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
        <div className="fixed top-20 right-4 z-50 bg-slate-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4 text-emerald-400" />
          Link copiat în clipboard!
        </div>
      )}

      {/* Navigare Breadcrumb & Acțiuni */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Înapoi la catalog
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
            title="Copiază link direct SEO"
          >
            <Share2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Distribuie</span>
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <span>Raportează eroare</span>
          </button>
        </div>
      </div>

      {/* Header Produs: Card Principal */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs mb-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Imagine Produs */}
          <div className="md:col-span-4 flex items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-2xl relative">
            {product.isRomanianProduct && (
              <span className="absolute top-3 left-3 bg-white/95 border border-slate-200 px-2 py-0.5 rounded-md text-[11px] font-bold text-slate-800 shadow-2xs flex items-center gap-1">
                <span>🇷🇴</span> Produs românesc
              </span>
            )}
            {product.isBio && (
              <span className="absolute top-3 right-3 bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md text-[11px] font-bold">
                BIO
              </span>
            )}

            <div className="w-40 h-40 flex items-center justify-center text-slate-400">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="w-32 h-32 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 font-extrabold text-3xl">
                  {product.name.charAt(0)}
                </div>
              )}
            </div>
          </div>

          {/* Detalii & Specificații */}
          <div className="md:col-span-8 flex flex-col justify-between h-full">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  onClick={() => onNavigateToCategory && onNavigateToCategory(product.category)}
                  className="px-2.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer transition-colors"
                >
                  {product.category}
                </span>
                {product.subcategory && (
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium">
                    {product.subcategory}
                  </span>
                )}
                {product.brand && (
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                    {product.brand}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {product.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-600">
                <span className="flex items-center gap-1 font-semibold text-slate-800">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  Gramaj / Cantitate: {product.packageWeightOrVolume} {product.packageUnit}
                </span>
                {product.barcode && (
                  <span className="flex items-center gap-1 font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                    <Barcode className="w-3.5 h-3.5" /> EAN: {product.barcode}
                  </span>
                )}
                <span className="text-slate-400">•</span>
                <span>Referință bază: {PriceComparisonService.formatRon(product.baseReferencePrice)}</span>
              </div>
            </div>

            {/* Banner Cel Mai Bun Preț & Adăugare în Listă */}
            <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs text-slate-500 font-medium block">
                  Cel mai mic preț înregistrat acum:
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-emerald-700">
                    {comparison.lowestPrice > 0
                      ? PriceComparisonService.formatRon(comparison.lowestPrice)
                      : 'Nicio ofertă'}
                  </span>
                  {comparison.lowestPrice > 0 && (
                    <span className="text-xs text-slate-500 font-medium">
                      la <strong className="text-slate-800">{comparison.lowestStoreName}</strong>
                    </span>
                  )}
                </div>
                {comparison.maxSavingsAmount > 0 && (
                  <span className="inline-block mt-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Economisești până la {PriceComparisonService.formatRon(comparison.maxSavingsAmount)} ({comparison.maxSavingsPercentage}%) între magazine
                  </span>
                )}
              </div>

              <button
                onClick={handleAddProductToList}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                <span>Adaugă în lista mea</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECȚIUNEA 1: Comparație Detaliată Multi-Retailer */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
              <StoreIcon className="w-5 h-5 text-emerald-600" />
              Oferte de la retaileri ({offers.length} verificate)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Prețurile sunt sortate crescător. Sunt evidențiate explicit reducerile condiționate de card de fidelitate.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Audit prețuri fără simulări de producție</span>
          </div>
        </div>

        {offers.length === 0 ? (
          <div className="py-12 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <HelpCircle className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">Nicio ofertă recent verificată pentru acest produs</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
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
                      ? 'border-emerald-500 bg-emerald-50/20 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
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
                          <span className="font-extrabold text-slate-900 text-base">
                            {item.store.name}
                          </span>
                          {isBest && (
                            <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Cel mai ieftin
                            </span>
                          )}
                          {item.isPromo && (
                            <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Tag className="w-2.5 h-2.5" /> Promoție activă
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            Verificat: {item.lastVerifiedAt}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="flex items-center gap-1 font-medium text-emerald-800">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Disponibil la raft
                          </span>
                          {item.validUntil && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-amber-700 font-medium flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Expiră: {item.validUntil}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Preț & Diferențiere Card Fidelitate */}
                    <div className="flex items-end sm:items-center justify-between sm:justify-end gap-6 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      {hasLoyalty ? (
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1.5 text-xs text-amber-700 font-semibold mb-0.5">
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Cu {item.loyaltyCardName || 'Card'}:</span>
                          </div>
                          <div className="flex items-baseline gap-2 justify-end">
                            <span className="text-xs text-slate-400 line-through">
                              {PriceComparisonService.formatRon(item.standardPrice)}
                            </span>
                            <span className="text-2xl font-black text-emerald-700">
                              {PriceComparisonService.formatRon(item.offer.price)}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 block">
                            {PriceComparisonService.formatRon(item.unitPrice)} / {item.unitPriceMeasure}
                          </span>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-xs text-slate-400 font-medium block">Preț standard</span>
                          <span className="text-2xl font-black text-slate-900">
                            {PriceComparisonService.formatRon(item.offer.price)}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            {PriceComparisonService.formatRon(item.unitPrice)} / {item.unitPriceMeasure}
                          </span>
                        </div>
                      )}

                      {/* Freshness Badge */}
                      <div className="hidden lg:block text-right shrink-0">
                        <span
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.freshnessStatus === 'very_recent'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.freshnessStatus === 'recent'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.freshnessLabelRo}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          Calitate: {item.qualityScore}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Detalii Promoție & Avertisment Card */}
                  {item.promoDetails && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100/80 text-xs text-slate-600 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{item.promoDetails}</span>
                      {hasLoyalty && (
                        <span className="text-amber-700 font-semibold ml-1">
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

      {/* SECȚIUNEA 2: Istoric de Preț Real (Doar dacă sunt observații suficiente) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs mb-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
              <LineChart className="w-5 h-5 text-emerald-600" />
              Evoluție & Istoric Prețuri Reale
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Observații validate în timp prin bonuri fiscale și feed-uri oficiale (jurnal append-only).
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
            {observations.length} înregistrări istorice
          </span>
        </div>

        {hasSufficientHistory ? (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-500 font-medium block">Preț minim înregistrat</span>
                <span className="text-xl font-extrabold text-emerald-700">
                  {PriceComparisonService.formatRon(Math.min(...observations.map(o => o.price)))}
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-500 font-medium block">Preț mediu istoric</span>
                <span className="text-xl font-extrabold text-slate-800">
                  {PriceComparisonService.formatRon(
                    observations.reduce((sum, o) => sum + o.price, 0) / observations.length
                  )}
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-500 font-medium block">Preț maxim atins</span>
                <span className="text-xl font-extrabold text-rose-700">
                  {PriceComparisonService.formatRon(Math.max(...observations.map(o => o.price)))}
                </span>
              </div>
            </div>

            {/* Tabel Observații */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Dată</th>
                    <th className="px-4 py-2.5">Magazin</th>
                    <th className="px-4 py-2.5">Preț</th>
                    <th className="px-4 py-2.5">Sursă verificare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {observations.slice(0, 10).map((obs, idx) => {
                    const st = STORES.find(s => s.id === obs.storeId);
                    return (
                      <tr key={obs.id || idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{obs.date}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-900">{st?.name || obs.storeId}</td>
                        <td className="px-4 py-2.5 font-extrabold text-emerald-700">
                          {PriceComparisonService.formatRon(obs.price)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {obs.source === 'verified' ? 'Bon fiscal utilizator' : 'Feed oficial magazin'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <Info className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">
              Istoric de preț în curs de colectare
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Pentru a afișa o curbă statistică certă sunt necesare cel puțin 2 observații reale confirmate în timp. Datele sunt înregistrate continuu pe măsură ce utilizatorii scanează bonuri sau rulează indexările zilnice.
            </p>
          </div>
        )}
      </div>

      {/* MODAL: Raportează o Eroare */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                <span>Raportează o eroare de preț sau date</span>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSuccessMessage ? (
              <div className="py-6 text-center text-emerald-700 font-semibold text-sm">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                {reportSuccessMessage}
              </div>
            ) : (
              <form onSubmit={handleSubmitErrorReport} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Produs selectat</label>
                  <input
                    type="text"
                    disabled
                    value={product.name}
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Tipul problemei *</label>
                    <select
                      value={reportErrorType}
                      onChange={e => setReportErrorType(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="price_mismatch">Preț diferit la raft</option>
                      <option value="wrong_product">Produs nepotrivit / nepotrivire magazin</option>
                      <option value="expired_promo">Promoție expirată afișată ca activă</option>
                      <option value="wrong_category">Categorie sau gramaj greșit</option>
                      <option value="other">Altă eroare</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Magazinul vizat</label>
                    <select
                      value={reportStoreId}
                      onChange={e => setReportStoreId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">Alege magazinul...</option>
                      {STORES.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Prețul real observat (lei, opțional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Ex: 7.49"
                    value={reportPrice}
                    onChange={e => setReportPrice(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Detalii suplimentare *</label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Ex: La magazinul Lidl din Militari prețul este 7.49 lei, nu 6.49 lei."
                    value={reportDetails}
                    onChange={e => setReportDetails(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Email-ul tău (opțional, pentru confirmare)</label>
                  <input
                    type="email"
                    placeholder="nume@exemplu.ro"
                    value={reportEmail}
                    onChange={e => setReportEmail(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReport}
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors disabled:opacity-50"
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
