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
  X,
  Bell,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Edit2,
  Trash2,
  ArrowRightLeft,
  Scale
} from 'lucide-react';
import {
  PriceAlert,
  PriceAlertType,
  PriceHistoryInterval,
  Product,
  Store,
  ProductOffer,
  PriceObservation,
  ShoppingList,
  FlaggedPriceObservation,
  PriceDataQualityAssessment,
  PriceDataQualityStatus,
  ProductAlternativesResult,
  ProductAlternativeKind
} from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { PriceAlertService } from '../services/PriceAlertService.js';
import { PriceQualityClassifier } from '../services/PriceQualityClassifier.js';
import { ProductAlternativesService } from '../services/ProductAlternativesService.js';
import { StorageService } from '../services/StorageService.js';
import { STORES, PRODUCTS } from '../data/mockData.js';
import { getSafeProductImageSrc } from '../utils/urlSecurity.js';
import { formatPriceSourceLabel } from '../services/PriceHistoryService.js';
import { ProductPriceTrend } from './ProductPriceTrend.js';
import {
  buildCanonicalAliasIndex,
  collectProductIdsForCanonical,
  resolveCanonicalProductId
} from '../services/ProductIdentityService.js';

interface ProductDetailViewProps {
  productId: string;
  onBack: () => void;
  onNavigateToCategory?: (category: string) => void;
  activeList?: ShoppingList;
  onAddToList?: (productId: string, productName: string, product?: Product) => Promise<boolean> | boolean | void;
  onSelectProduct?: (productId: string) => void;
  useLoyaltyCards?: boolean;
  onCreateAlertForProduct?: (product: Product, suggestedPrice?: number) => void;
  productAlerts?: PriceAlert[];
  onSaveProductAlert?: (alert: PriceAlert) => void;
  onToggleProductAlert?: (alertId: string) => void;
  onDeleteProductAlert?: (alertId: string) => void;
}

function resolveDetailStoreName(storeId: string): string {
  const norm = (storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
  const found = STORES.find(
    s => s.id === storeId || s.id.toLowerCase().replace(/^store-/, '') === norm || (s.slug || '').toLowerCase() === norm
  );
  return found?.name || storeId || 'Magazin';
}

export const ProductDetailView: React.FC<ProductDetailViewProps> = ({
  productId,
  onBack,
  onNavigateToCategory,
  activeList,
  onAddToList,
  onSelectProduct,
  useLoyaltyCards = true,
  onCreateAlertForProduct,
  productAlerts = [],
  onSaveProductAlert,
  onToggleProductAlert,
  onDeleteProductAlert
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [alternativesData, setAlternativesData] = useState<ProductAlternativesResult | null>(null);
  const [alternativesLoading, setAlternativesLoading] = useState<boolean>(false);
  const [data, setData] = useState<{
    product: Product;
    comparison: any;
    observations: PriceObservation[];
    hasSufficientHistory: boolean;
    offerQualityByOfferId?: Record<string, PriceDataQualityAssessment>;
    observationQualityById?: Record<string, PriceDataQualityAssessment>;
    flaggedObservations?: FlaggedPriceObservation[];
  } | null>(null);
  const [expandedQualityKey, setExpandedQualityKey] = useState<string | null>(null);

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

  // Modal configurare / editare alertă de preț direct pe pagina produsului
  const [showAlertModal, setShowAlertModal] = useState<boolean>(false);
  const [editingAlert, setEditingAlert] = useState<PriceAlert | null>(null);
  const [alertTypeInput, setAlertTypeInput] = useState<PriceAlertType>('below_target');
  const [alertIntervalInput, setAlertIntervalInput] = useState<PriceHistoryInterval>(90);
  const [alertTargetPriceInput, setAlertTargetPriceInput] = useState<number>(5);

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
            hasSufficientHistory: resData.hasSufficientHistory,
            offerQualityByOfferId: resData.offerQualityByOfferId,
            observationQualityById: resData.observationQualityById,
            flaggedObservations: resData.flaggedObservations || []
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
      const localProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(localProducts);
      const canonicalProductId = resolveCanonicalProductId(productId, aliasIndex) || productId;
      const comparison = PriceComparisonService.getProductComparisonDetails(
        canonicalProductId,
        undefined,
        undefined,
        undefined,
        aliasIndex
      );
      if (comparison) {
        const equivalentIds = new Set(collectProductIdsForCanonical(comparison.product.id, aliasIndex));
        const obs = StorageService.getPriceObservations().filter(o => equivalentIds.has(o.productId));
        const batch = PriceQualityClassifier.classifyObservationBatch(obs, {
          product: comparison.product,
          expectedProductId: comparison.product.id,
          aliasSource: aliasIndex
        });
        setData({
          product: comparison.product,
          comparison,
          observations: obs,
          hasSufficientHistory: obs.length >= 2,
          observationQualityById: batch.assessmentsById,
          flaggedObservations: []
        });
      }
    }

    return () => {
      isMounted = false;
    };
  }, [productId]);

  useEffect(() => {
    let isMounted = true;
    setAlternativesLoading(true);
    fetch(`/api/products/${encodeURIComponent(productId)}/alternatives?useLoyaltyCards=${useLoyaltyCards ? 'true' : 'false'}`)
      .then(res => res.json())
      .then(resData => {
        if (!isMounted) return;
        if (resData?.success && resData.alternatives) {
          setAlternativesData(resData.alternatives as ProductAlternativesResult);
        } else {
          const allProductsRaw = StorageService.getAllProducts();
          const allProducts = allProductsRaw.length > 0 ? allProductsRaw : PRODUCTS;
          const aliasIndex = buildCanonicalAliasIndex(allProducts);
          const aliasMap = new Map<string, string>();
          for (const [k, v] of aliasIndex.parentById.entries()) {
            if (v) aliasMap.set(k, v);
          }
          const canonicalProductId = resolveCanonicalProductId(productId, aliasIndex) || productId;
          const targetProduct =
            allProducts.find(p => p.id === canonicalProductId) ||
            allProducts.find(p => p.id === productId);
          if (targetProduct) {
            const allOffers = StorageService.getProductOffers();
            setAlternativesData(
              ProductAlternativesService.getAlternatives({
                targetProduct,
                allProducts,
                allOffers,
                stores: STORES,
                useLoyaltyCards,
                aliasMap
              })
            );
          } else {
            setAlternativesData(null);
          }
        }
      })
      .catch(() => {
        if (!isMounted) return;
        const allProductsRaw = StorageService.getAllProducts();
        const allProducts = allProductsRaw.length > 0 ? allProductsRaw : PRODUCTS;
        const aliasIndex = buildCanonicalAliasIndex(allProducts);
        const aliasMap = new Map<string, string>();
        for (const [k, v] of aliasIndex.parentById.entries()) {
          if (v) aliasMap.set(k, v);
        }
        const canonicalProductId = resolveCanonicalProductId(productId, aliasIndex) || productId;
        const targetProduct =
          allProducts.find(p => p.id === canonicalProductId) ||
          allProducts.find(p => p.id === productId);
        if (targetProduct) {
          const allOffers = StorageService.getProductOffers();
          setAlternativesData(
            ProductAlternativesService.getAlternatives({
              targetProduct,
              allProducts,
              allOffers,
              stores: STORES,
              useLoyaltyCards,
              aliasMap
            })
          );
        } else {
          setAlternativesData(null);
        }
      })
      .finally(() => {
        if (isMounted) setAlternativesLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [productId, useLoyaltyCards]);

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

  const openProductAlertModal = (existing?: PriceAlert) => {
    if (!data?.product) return;
    if (!onSaveProductAlert && onCreateAlertForProduct && !existing) {
      onCreateAlertForProduct(
        data.product,
        data.comparison?.lowestPrice > 0 ? data.comparison.lowestPrice : data.product.baseReferencePrice
      );
      return;
    }
    const basePrice =
      data.comparison?.lowestPrice > 0
        ? data.comparison.lowestPrice
        : data.product.baseReferencePrice || 5;
    if (existing) {
      setEditingAlert(existing);
      setAlertTypeInput(existing.alertType || 'below_target');
      setAlertIntervalInput(existing.intervalDays || 90);
      setAlertTargetPriceInput(existing.targetPrice > 0 ? existing.targetPrice : Math.max(0.1, Math.round(basePrice * 0.9 * 100) / 100));
    } else {
      setEditingAlert(null);
      setAlertTypeInput('below_target');
      setAlertIntervalInput(90);
      setAlertTargetPriceInput(Math.max(0.1, Math.round(basePrice * 0.9 * 100) / 100));
    }
    setShowAlertModal(true);
  };

  const handleSaveProductAlertModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.product || !onSaveProductAlert) return;
    if (alertTypeInput === 'below_target' && alertTargetPriceInput <= 0) return;

    const lowestCurrent = data.comparison?.lowestPrice > 0 ? data.comparison.lowestPrice : 0;
    const lowestStoreId = data.comparison?.offers?.[0]?.store?.id;
    const baseTarget = lowestCurrent > 0 ? lowestCurrent : data.product.baseReferencePrice || 1;

    const nextAlert: PriceAlert = editingAlert
      ? {
          ...editingAlert,
          alertType: alertTypeInput,
          intervalDays: alertTypeInput === 'interval_low' ? alertIntervalInput : undefined,
          targetPrice: alertTypeInput === 'below_target' ? alertTargetPriceInput : editingAlert.targetPrice || baseTarget
        }
      : {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `alert-${Date.now()}`,
          productId: data.product.id,
          productName: `${data.product.name}${data.product.brand ? ` (${data.product.brand})` : ''}`,
          targetPrice: alertTypeInput === 'below_target' ? alertTargetPriceInput : Math.max(0.01, baseTarget),
          currentLowestPrice: lowestCurrent,
          lowestStoreId,
          createdAt: new Date().toISOString().slice(0, 10),
          isActive: true,
          alertType: alertTypeInput,
          intervalDays: alertTypeInput === 'interval_low' ? alertIntervalInput : undefined,
          lastEvaluatedPrice: lowestCurrent > 0 ? lowestCurrent : undefined
        };

    onSaveProductAlert(nextAlert);
    setShowAlertModal(false);
    setEditingAlert(null);
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

              <div className="flex flex-wrap items-center gap-2.5">
                {(onSaveProductAlert || onCreateAlertForProduct) && (
                  <button
                    type="button"
                    onClick={() => openProductAlertModal()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-bold text-sm transition-colors cursor-pointer"
                  >
                    <Bell className="w-4 h-4" />
                    <span>Setează alertă</span>
                  </button>
                )}

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

            {/* Alertele configurate pentru acest produs */}
            {productAlerts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Alertele tale active pentru acest produs ({productAlerts.filter(a => a.isActive).length}/{productAlerts.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {productAlerts.map(alert => (
                    <div
                      key={alert.id}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs tabular-nums ${
                        alert.isActive
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span className="font-semibold">
                        {PriceAlertService.getAlertTypeLabel(alert.alertType, alert.intervalDays)}
                        {(alert.alertType || 'below_target') === 'below_target' &&
                          ` (${PriceComparisonService.formatRon(alert.targetPrice)})`}
                      </span>
                      {!alert.isActive && <span className="text-[10px] font-bold">· Oprită</span>}
                      {onToggleProductAlert && (
                        <button
                          type="button"
                          onClick={() => onToggleProductAlert(alert.id)}
                          className="p-1 rounded hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                          title={alert.isActive ? 'Oprește temporar alerta' : 'Reactivează alerta'}
                        >
                          {alert.isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      )}
                      {onSaveProductAlert && (
                        <button
                          type="button"
                          onClick={() => openProductAlertModal(alert)}
                          className="p-1 rounded hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                          title="Editează alerta"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                      {onDeleteProductAlert && (
                        <button
                          type="button"
                          onClick={() => onDeleteProductAlert(alert.id)}
                          className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                          title="Șterge alerta"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              const offerKey = item.offer?.id || `${item.store.id}-${idx}`;
              const qualityAssessment: PriceDataQualityAssessment =
                (item.offer?.id && data.offerQualityByOfferId?.[item.offer.id]) ||
                PriceQualityClassifier.classifyOffer(item.offer, { product });
              const isQualityExpanded = expandedQualityKey === offerKey;

              return (
                <div
                  key={offerKey}
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

                      {/* Stare calitate și detalii verificare (fără supraîncărcare cu scor numeric) */}
                      <div className="text-right shrink-0 space-y-0.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            qualityAssessment.status === 'VERIFIED_RECENTLY'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : qualityAssessment.status === 'VERIFIED'
                              ? 'text-sky-700 dark:text-sky-400'
                              : qualityAssessment.status === 'STALE' || qualityAssessment.status === 'UNVERIFIED'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {qualityAssessment.status === 'VERIFIED_RECENTLY' || qualityAssessment.status === 'VERIFIED' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : qualityAssessment.status === 'STALE' ? (
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                          ) : qualityAssessment.status === 'UNVERIFIED' ? (
                            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{qualityAssessment.labelRo}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedQualityKey(isQualityExpanded ? null : offerKey)}
                          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 flex items-center justify-end gap-0.5 ml-auto cursor-pointer whitespace-nowrap"
                        >
                          <span>Detalii verificare</span>
                          {isQualityExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
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

                  {/* Metodologie transparentă pentru această ofertă */}
                  {isQualityExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl p-3.5 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          Criterii verificare preț
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">{qualityAssessment.descriptionRo}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {qualityAssessment.factors.map(factor => (
                          <div
                            key={factor.key}
                            className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/70 flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                                {factor.labelRo}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                {factor.detailRo}
                              </span>
                            </div>
                            {qualityAssessment.hasEnoughDataForScore !== false && (
                              <span className="font-semibold text-slate-600 dark:text-slate-300 font-mono text-[11px] tabular-nums shrink-0">
                                {factor.score}/100
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECȚIUNEA 1B: Produse alternative & comparație pe preț normalizat */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>Produse alternative & economii pe unitate</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comparație bazată strict pe prețul normalizat ({alternativesData?.referenceNormalizedUnitLabel || 'lei/unitate'}) și compatibilitate de categorie.
            </p>
          </div>
          {alternativesData?.referenceNormalizedUnitPrice && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums self-start sm:self-auto">
              <Scale className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                Referință produs: {PriceComparisonService.formatRon(alternativesData.referenceNormalizedUnitPrice)} / {alternativesData.referenceNormalizedUnitLabel}
              </span>
            </div>
          )}
        </div>

        {alternativesLoading ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">
            Se calculează alternativele compatibile pe unitate de măsură...
          </div>
        ) : !alternativesData || alternativesData.totalCount === 0 ? (
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300">
            Nu am găsit în acest moment alternative compatibile cu oferte active valide în catalog pentru acest produs.
          </div>
        ) : (
          <div className="space-y-5">
            {(
              [
                { key: 'same_product_other_retailer', title: 'Același produs la alt retailer' },
                { key: 'same_product_other_size', title: 'Același produs în alt gramaj' },
                { key: 'private_label', title: 'Marcă proprie' },
                { key: 'alternative_brand', title: 'Branduri alternative' },
                { key: 'similar_product', title: 'Produse similare compatibile' }
              ] as Array<{ key: ProductAlternativeKind; title: string }>
            ).map(group => {
              const items = alternativesData.groups[group.key] || [];
              if (items.length === 0) return null;
              return (
                <div key={group.key} className="space-y-2.5">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {group.title} ({items.length})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {items.map((alt, idx) => (
                      <div
                        key={`${group.key}-${alt.product.id}-${alt.store.id}-${idx}`}
                        className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col justify-between gap-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {alt.product.name}
                              </span>
                              {alt.isPrivateLabel && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300">
                                  Marcă proprie
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {alt.product.brand || 'Generic'} · {alt.product.packageWeightOrVolume} {alt.product.packageUnit} · La <strong>{alt.store.name}</strong>
                            </p>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <span className="font-black text-base text-slate-900 dark:text-slate-100 block">
                              {PriceComparisonService.formatRon(alt.price)}
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block">
                              {PriceComparisonService.formatRon(alt.normalizedUnitPrice)} / {alt.normalizedUnitLabel}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {alt.isCheaperNormalized && alt.savingsPercent > 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 tabular-nums">
                                -{alt.savingsPercent.toFixed(0)}% / {alt.normalizedUnitLabel}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {alt.compatibilityReasonRo}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {onSelectProduct && alt.product.id !== product.id && (
                              <button
                                type="button"
                                onClick={() => onSelectProduct(alt.product.id)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                              >
                                Vezi
                              </button>
                            )}
                            {onAddToList && (
                              <button
                                type="button"
                                onClick={() => void onAddToList(alt.product.id, alt.product.name, alt.product)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Listă</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECȚIUNEA 2: Istoricul prețurilor (30 / 90 / 180 / 365 zile, date reale) */}
      <ProductPriceTrend
        productId={product.id}
        productName={product.name}
        product={product}
        observations={observations}
        flaggedObservations={data.flaggedObservations}
        stores={STORES}
      />

      {/* SECȚIUNEA 3: Jurnal Observații Preț Reale */}
      {(observations.length > 0 || (data.flaggedObservations && data.flaggedObservations.length > 0)) && (() => {
        const localBatch = PriceQualityClassifier.classifyObservationBatch(observations, {
          product,
          expectedProductId: product.id
        });
        const flaggedRows = data.flaggedObservations || [];
        const sortedCleanObs = [...observations]
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
          .slice(0, 20);

        const renderStatusColorClass = (st: PriceDataQualityStatus) =>
          st === 'VERIFIED_RECENTLY'
            ? 'text-emerald-700 dark:text-emerald-400'
            : st === 'VERIFIED'
            ? 'text-sky-700 dark:text-sky-400'
            : st === 'STALE'
            ? 'text-amber-700 dark:text-amber-400'
            : st === 'SUSPICIOUS' || st === 'EXPIRED'
            ? 'text-rose-700 dark:text-rose-400'
            : 'text-slate-600 dark:text-slate-300';

        return (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs mb-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <LineChart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  Jurnal Observații Prețuri Reale
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Observații validate în timp cu stare de verificare explicată (ordonate de la cea mai recentă; nu garantează disponibilitatea actuală la raft).
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                {observations.length} înregistrări istorice
                {flaggedRows.length > 0 ? ` · ${flaggedRows.length} semnalate` : ''}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5">Data observației</th>
                    <th className="px-4 py-2.5">Retailer</th>
                    <th className="px-4 py-2.5">Preț</th>
                    <th className="px-4 py-2.5">Sursă verificare</th>
                    <th className="px-4 py-2.5">Calitate & explicație</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedCleanObs.map((obs, idx) => {
                    const assessment =
                      (obs.id && data.observationQualityById?.[obs.id]) ||
                      (obs.id && localBatch.assessmentsById[obs.id]) ||
                      localBatch.assessmentsById[`obs-${idx}`];
                    return (
                      <tr key={obs.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{obs.date}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                          {resolveDetailStoreName(obs.storeId)}
                        </td>
                        <td className="px-4 py-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 font-mono">
                          {PriceComparisonService.formatRon(obs.price)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                          <span>{formatPriceSourceLabel(obs.source)}</span>
                          {obs.originalProductId && obs.originalProductId !== product.id && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-1.5">
                              · Variantă asociată
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {assessment ? (
                            <div className="space-y-0.5">
                              <span className={`font-semibold block ${renderStatusColorClass(assessment.status)}`}>
                                {assessment.labelRo}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                {assessment.reasons[0] || assessment.descriptionRo}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {flaggedRows.slice(0, 10).map(flagged => (
                    <tr key={`flagged-${flagged.id}`} className="bg-rose-50/35 dark:bg-rose-950/20">
                      <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">
                        {flagged.date || 'Dată lipsă'}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        {flagged.storeName || resolveDetailStoreName(flagged.storeId)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-rose-700 dark:text-rose-300">
                        {Number.isFinite(flagged.price)
                          ? `${flagged.price.toFixed(2)} ${flagged.currency || 'RON'}`
                          : 'Preț invalid'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        {flagged.sourceLabel || formatPriceSourceLabel(flagged.source)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-rose-700 dark:text-rose-400 block">
                          {flagged.qualityAssessment.labelRo} (exclus din medii)
                        </span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
                          {flagged.qualityAssessment.reasons[0] || flagged.qualityAssessment.descriptionRo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

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

      {/* MODAL: Setează / Editează Alertă de Preț pentru Produs */}
      {showAlertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-base">
                <Bell className="w-5 h-5" />
                <span>{editingAlert ? 'Editează alerta de preț' : 'Setează alertă de preț'}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAlertModal(false);
                  setEditingAlert(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Produs: <strong className="text-slate-800 dark:text-slate-200">{product.name}</strong>
            </p>

            <form onSubmit={handleSaveProductAlertModal} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Tip alertă
                </label>
                {[
                  { type: 'below_target' as PriceAlertType, label: 'Preț maxim dorit (RON)' },
                  { type: 'any_drop' as PriceAlertType, label: 'Alertă la reducere față de ultimul preț verificat' },
                  { type: 'interval_low' as PriceAlertType, label: 'Alertă la cel mai mic preț observat în interval' }
                ].map(item => (
                  <label
                    key={item.type}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer ${
                      alertTypeInput === item.type
                        ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="productAlertType"
                      checked={alertTypeInput === item.type}
                      onChange={() => setAlertTypeInput(item.type)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>

              {alertTypeInput === 'below_target' && (
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Preț maxim dorit (lei)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      required
                      value={alertTargetPriceInput}
                      onChange={e => setAlertTargetPriceInput(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-emerald-500 tabular-nums"
                    />
                    <span className="absolute right-3 top-3 text-xs text-slate-400 font-bold">RON</span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block tabular-nums">
                    Cel mai mic preț curent:{' '}
                    {comparison.lowestPrice > 0 ? PriceComparisonService.formatRon(comparison.lowestPrice) : 'Indisponibil'}
                  </span>
                </div>
              )}

              {alertTypeInput === 'interval_low' && (
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Interval de referință
                  </label>
                  <select
                    value={alertIntervalInput}
                    onChange={e => setAlertIntervalInput(Number(e.target.value) as PriceHistoryInterval)}
                    className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100"
                  >
                    <option value={30}>Ultimele 30 zile</option>
                    <option value={90}>Ultimele 90 zile</option>
                    <option value={180}>Ultimele 180 zile</option>
                    <option value={365}>Ultimul 1 an</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAlertModal(false);
                    setEditingAlert(null);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  {editingAlert ? 'Salvează modificările' : 'Activează alerta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
