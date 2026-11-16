// src/components/ProductsView.tsx
// Catalog public de produse organizat pe categorii și subcategorii cu comparație multi-retailer

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  Tag,
  Store,
  Layers,
  Sparkles,
  ShoppingBag,
  Clock,
  CheckCircle2,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  X,
  CreditCard,
  Plus,
  Check,
  RotateCcw,
  Apple,
  Milk,
  Beef,
  Croissant,
  Package,
  Coffee,
  Snowflake,
  Heart,
  MoreHorizontal
} from 'lucide-react';
import { Product, Store as StoreType, ShoppingList } from '../types.js';
import { CATEGORIES_TAXONOMY, CategoryDefinition } from '../data/categories.js';
import { getSafeProductImageSrc } from '../utils/urlSecurity.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { StorageService } from '../services/StorageService.js';
import { STORES } from '../data/mockData.js';

interface ProductsViewProps {
  onSelectProduct: (productId: string) => void;
  activeList?: ShoppingList;
  onAddToList?: (productId: string, productName: string, product?: Product) => Promise<boolean> | boolean | void;
  initialCategory?: string;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  onSelectProduct,
  activeList,
  onAddToList,
  initialCategory
}) => {
  // Filters state
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'toate');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');
  const [selectedBrand, setSelectedBrand] = useState<string>('toate');
  const [selectedRetailer, setSelectedRetailer] = useState<string>('toate');
  const [onlyPromo, setOnlyPromo] = useState<boolean>(false);
  const [onlyAvailable, setOnlyAvailable] = useState<boolean>(false);
  const [onlyRomanian, setOnlyRomanian] = useState<boolean>(false);
  const [onlyBio, setOnlyBio] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>('relevance');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 12;

  // Data & loading state
  const [loading, setLoading] = useState<boolean>(true);
  const [productsData, setProductsData] = useState<{
    products: any[];
    totalCount: number;
    totalPages: number;
    facets: { categories: any[]; brands: any[] };
  }>({
    products: [],
    totalCount: 0,
    totalPages: 1,
    facets: { categories: [], brands: [] }
  });

  const [categories, setCategories] = useState<any[]>(CATEGORIES_TAXONOMY);
  const [addedItemName, setAddedItemName] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());

  // Store lookup map
  const storeMap = useMemo(() => new Map<string, StoreType>(STORES.map(s => [s.id, s])), []);

  // Sync initialCategory prop if passed from parent
  useEffect(() => {
    if (initialCategory && initialCategory !== selectedCategory) {
      setSelectedCategory(initialCategory);
      setSelectedSubcategory('');
      setCurrentPage(1);
    }
  }, [initialCategory]);

  // Load categories taxonomy
  useEffect(() => {
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.categories) {
          setCategories(data.categories);
        }
      })
      .catch(() => {
        // Fallback to static CATEGORIES_TAXONOMY
        setCategories(CATEGORIES_TAXONOMY);
      });
  }, []);

  // Debounce search input to avoid firing API calls on every keystroke
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Fetch products based on filters and pagination
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      page: currentPage.toString(),
      limit: pageSize.toString(),
      sortBy
    });

    if (selectedCategory && selectedCategory !== 'toate') {
      params.set('category', selectedCategory);
    }
    if (selectedSubcategory) {
      params.set('subcategory', selectedSubcategory);
    }
    if (debouncedSearchQuery.trim()) {
      params.set('search', debouncedSearchQuery.trim());
    }
    if (selectedBrand && selectedBrand !== 'toate') {
      params.set('brand', selectedBrand);
    }
    if (selectedRetailer && selectedRetailer !== 'toate') {
      params.set('retailer', selectedRetailer);
    }
    if (onlyPromo) {
      params.set('onlyPromo', 'true');
    }
    if (onlyAvailable) {
      params.set('onlyAvailable', 'true');
    }

    fetch(`/api/products?${params.toString()}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.success) {
          let list = data.products || [];
          if (onlyRomanian) list = list.filter((p: any) => p.isRomanianProduct);
          if (onlyBio) list = list.filter((p: any) => p.isBio);

          setProductsData({
            products: list,
            totalCount: data.pagination.totalCount,
            totalPages: data.pagination.totalPages,
            facets: data.facets || { categories: [], brands: [] }
          });
        }
      })
      .catch((err) => {
        if (!isMounted || err?.name === 'AbortError') return;
        // Client-side fallback from StorageService
        const all = StorageService.getAllProducts();
        const allOffers = StorageService.getProductOffers();
        const todayStr = new Date().toISOString().split('T')[0];

        const enriched = all.map(p => {
          const validOffers = allOffers.filter(
            o => o.productId === p.id && PriceComparisonService.isOfferValid(o)
          ).sort((a, b) => a.price - b.price);

          const minOffer = validOffers[0];
          return {
            ...p,
            minPrice: minOffer ? minOffer.price : null,
            lowestStoreId: minOffer ? minOffer.storeId : null,
            offersCount: validOffers.length,
            isPromo: validOffers.some(o => o.isPromo),
            loyaltyCardRequired: minOffer?.loyaltyCardRequired || false,
            loyaltyCardName: minOffer?.loyaltyCardName,
            lastVerifiedAt: minOffer?.observationDate || null,
            freshnessStatus: minOffer?.freshnessStatus || (minOffer ? 'recent' : 'expired'),
            qualityScore: minOffer?.qualityScore || 80
          };
        });

        let filtered = enriched;
        if (selectedCategory && selectedCategory !== 'toate') {
          filtered = filtered.filter(p => p.category === selectedCategory);
        }
        if (selectedSubcategory) {
          filtered = filtered.filter(p => p.subcategory === selectedSubcategory);
        }
        if (debouncedSearchQuery.trim()) {
          const q = debouncedSearchQuery.toLowerCase().trim();
          filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
        }
        if (selectedBrand && selectedBrand !== 'toate') {
          filtered = filtered.filter(p => p.brand.toLowerCase() === selectedBrand.toLowerCase());
        }
        if (selectedRetailer && selectedRetailer !== 'toate') {
          filtered = filtered.filter(p => allOffers.some(o => o.productId === p.id && o.storeId === selectedRetailer));
        }
        if (onlyPromo) filtered = filtered.filter(p => p.isPromo);
        if (onlyAvailable) filtered = filtered.filter(p => p.offersCount > 0);
        if (onlyRomanian) filtered = filtered.filter(p => p.isRomanianProduct);
        if (onlyBio) filtered = filtered.filter(p => p.isBio);

        setProductsData({
          products: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
          totalCount: filtered.length,
          totalPages: Math.ceil(filtered.length / pageSize) || 1,
          facets: { categories: [], brands: [] }
        });
      })
      .finally(() => {
        if (isMounted && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    selectedCategory,
    selectedSubcategory,
    debouncedSearchQuery,
    selectedBrand,
    selectedRetailer,
    onlyPromo,
    onlyAvailable,
    onlyRomanian,
    onlyBio,
    sortBy,
    currentPage
  ]);

  const handleResetFilters = () => {
    setSelectedCategory('toate');
    setSelectedSubcategory('');
    setSearchQuery('');
    setSelectedBrand('toate');
    setSelectedRetailer('toate');
    setOnlyPromo(false);
    setOnlyAvailable(false);
    setOnlyRomanian(false);
    setOnlyBio(false);
    setSortBy('relevance');
    setCurrentPage(1);
  };

  const handleQuickAdd = async (e: React.MouseEvent, p: Product) => {
    e.stopPropagation();
    let added: boolean | void = true;
    if (onAddToList) {
      added = await onAddToList(p.id, p.name, p);
    } else {
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
      } else {
        const listId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `list-${Date.now()}`;
        StorageService.saveShoppingLists([{
          id: listId,
          name: 'Coșul Meu',
          items: [{
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
          }],
          createdAt: nowIso,
          updatedAt: nowIso
        }]);
      }
    }
    if (added !== false) {
      setAddedItemName(p.name);
      setTimeout(() => setAddedItemName(null), 2500);
    }
  };

  // Helper icon renderer
  const renderCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'Apple': return <Apple className="w-4 h-4" />;
      case 'Milk': return <Milk className="w-4 h-4" />;
      case 'Beef': return <Beef className="w-4 h-4" />;
      case 'Croissant': return <Croissant className="w-4 h-4" />;
      case 'Package': return <Package className="w-4 h-4" />;
      case 'Coffee': return <Coffee className="w-4 h-4" />;
      case 'Snowflake': return <Snowflake className="w-4 h-4" />;
      case 'Sparkles': return <Sparkles className="w-4 h-4" />;
      case 'Heart': return <Heart className="w-4 h-4" />;
      default: return <MoreHorizontal className="w-4 h-4" />;
    }
  };

  // Active category object
  const activeCategoryObj = useMemo(() => {
    return categories.find(c => c.name === selectedCategory);
  }, [categories, selectedCategory]);

  return (
    <div className="max-w-7xl mx-auto pb-16">
      {/* Toast notificare */}
      {addedItemName && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-700 text-white text-xs sm:text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
          <span>„{addedItemName}” a fost adăugat în listă!</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1.5 tabular-nums">
            Catalog național · {productsData.totalCount} produse indexate · Prețuri verificate
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight">
            Produse & Prețuri Supermarket
          </h1>
          <p className="text-slate-600 text-sm mt-1 max-w-2xl">
            Compară prețurile actualizate din Lidl, Kaufland, Carrefour, Penny, Auchan, Profi, Mega Image și Metro.
          </p>
        </div>

        {/* Căutare rapidă */}
        <div className="w-full md:w-80 relative shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Caută produse după nume, brand sau EAN"
            placeholder="Caută produs, brand sau EAN..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-white border border-slate-200 pl-10 pr-9 py-2.5 rounded-xl text-sm text-slate-800 placeholder-slate-400 font-medium focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setDebouncedSearchQuery('');
              }}
              aria-label="Șterge căutarea"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bară Categorii */}
      <div className="mb-4 overflow-x-auto no-scrollbar pb-1">
        <div className="flex items-center gap-1.5 min-w-max">
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('toate');
              setSelectedSubcategory('');
              setCurrentPage(1);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'toate'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span>Toate produsele</span>
            <span className={`text-xs tabular-nums ${
              selectedCategory === 'toate' ? 'text-slate-300' : 'text-slate-400'
            }`}>
              {productsData.totalCount}
            </span>
          </button>

          {categories.map(cat => {
            const isSelected = selectedCategory === cat.name;
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.name);
                  setSelectedSubcategory('');
                  setCurrentPage(1);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className={isSelected ? 'text-white' : 'text-emerald-700'}>
                  {renderCategoryIcon(cat.iconName)}
                </span>
                <span>{cat.name}</span>
                {cat.availableWithOffersCount !== undefined && (
                  <span className={`text-xs tabular-nums ${
                    isSelected ? 'text-emerald-100' : 'text-slate-400'
                  }`}>
                    {cat.availableWithOffersCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subcategorii (dacă o categorie este selectată și are subcategorii) */}
      {activeCategoryObj && activeCategoryObj.subcategories?.length > 0 && (
        <div className="mb-5 bg-slate-50 p-2.5 rounded-2xl border border-slate-200 flex flex-wrap items-center gap-2 animate-in fade-in">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2">Subcategorii:</span>
          <button
            onClick={() => {
              setSelectedSubcategory('');
              setCurrentPage(1);
            }}
            className={`px-2.5 py-1 rounded-xl text-xs font-medium transition-colors ${
              !selectedSubcategory
                ? 'bg-emerald-700 text-white font-bold'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            Toate din {activeCategoryObj.name}
          </button>
          {activeCategoryObj.subcategories.map((sub: any) => (
            <button
              key={sub.id}
              onClick={() => {
                setSelectedSubcategory(sub.name);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-xl text-xs font-medium transition-colors ${
                selectedSubcategory === sub.name
                  ? 'bg-emerald-700 text-white font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* Bară de Filtre & Sortare */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 mb-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Toggles rapide de filtrare */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setOnlyPromo(!onlyPromo);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                onlyPromo
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Doar promoții</span>
            </button>

            <button
              onClick={() => {
                setOnlyAvailable(!onlyAvailable);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                onlyAvailable
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Doar cu oferte active</span>
            </button>

            <button
              onClick={() => {
                setOnlyRomanian(!onlyRomanian);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                onlyRomanian
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <span>🇷🇴</span>
              <span>Produs românesc</span>
            </button>

            <button
              onClick={() => {
                setOnlyBio(!onlyBio);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                onlyBio
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <span>BIO</span>
            </button>

            {(onlyPromo || onlyAvailable || onlyRomanian || onlyBio || selectedCategory !== 'toate' || searchQuery || selectedBrand !== 'toate' || selectedRetailer !== 'toate') && (
              <button
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1"
                title="Resetează toate filtrele"
              >
                <RotateCcw className="w-3 h-3" /> Resetează filtre
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="retailer-filter" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
              Retailer:
            </label>
            <select
              id="retailer-filter"
              value={selectedRetailer}
              onChange={e => {
                setSelectedRetailer(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
            >
              <option value="toate">Toți retailerii</option>
              {STORES.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>

          {/* Sortare */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" /> Sortează:
            </span>
            <select
              value={sortBy}
              onChange={e => {
                setSortBy(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
            >
              <option value="relevance">Cele mai populare</option>
              <option value="price_asc">Cel mai mic preț</option>
              <option value="price_desc">Cel mai mare preț</option>
              <option value="freshness">Actualitatea datelor</option>
              <option value="retailers_count">Cele mai multe magazine</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid Produse */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white p-4 rounded-2xl border border-slate-200/90 h-[340px] flex flex-col justify-between">
              <div className="h-36 bg-slate-100 rounded-xl mb-3"></div>
              <div className="space-y-2">
                <div className="h-3 bg-slate-100 rounded w-1/3"></div>
                <div className="h-4 bg-slate-100 rounded w-4/5"></div>
              </div>
              <div className="h-10 bg-slate-100 rounded-xl mt-4"></div>
            </div>
          ))}
        </div>
      ) : productsData.products.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
          <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">Nu am găsit niciun produs conform filtrelor</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Încearcă să resetezi filtrele sau să cauți alt termen pentru a descoperi catalogul disponibil.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Resetează toate filtrele
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {productsData.products.map(product => {
            const hasOffers = product.offersCount > 0 && product.minPrice !== null;
            const lowestStore = product.lowestStoreId ? storeMap.get(product.lowestStoreId) : null;
            const safeImageSrc = getSafeProductImageSrc(product.imageUrl);

            return (
              <div
                key={product.id}
                onClick={() => onSelectProduct(product.id)}
                className="group surface-card surface-card-interactive rounded-2xl p-4 flex flex-col justify-between cursor-pointer"
              >
                <div>
                  {/* Imagine Produs (lead with clean neutral image stage) */}
                  <div className="h-36 w-full bg-slate-50/90 rounded-xl flex items-center justify-center p-3 mb-3.5 overflow-hidden">
                    {safeImageSrc && !failedImageIds.has(product.id) ? (
                      <img
                        src={safeImageSrc}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        decoding="async"
                        className="max-h-full max-w-full object-contain rounded-lg transition-transform duration-200 group-hover:scale-[1.04]"
                        loading="lazy"
                        onError={() => {
                          setFailedImageIds(prev => {
                            if (prev.has(product.id)) return prev;
                            const next = new Set(prev);
                            next.add(product.id);
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 font-display font-bold text-xl">
                        {product.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  {/* Clean unboxed metadata kicker */}
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-medium truncate">
                      {[product.brand, `${product.packageWeightOrVolume} ${product.packageUnit}`].filter(Boolean).join(' · ')}
                    </span>
                    {(product.isRomanianProduct || product.isBio) && (
                      <span className="shrink-0 font-semibold text-emerald-700">
                        {[product.isRomanianProduct ? 'RO' : null, product.isBio ? 'BIO' : null].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>

                  {/* Titlu */}
                  <h3 className="font-semibold text-[15px] text-slate-900 group-hover:text-emerald-700 line-clamp-2 leading-snug transition-colors">
                    {product.name}
                  </h3>
                </div>

                {/* Preț & Retaileri */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  {hasOffers ? (
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-[11px] text-slate-400 font-medium block">
                            Cel mai mic preț
                          </span>
                          <span className="font-display text-xl font-bold text-emerald-700 tabular-nums">
                            {PriceComparisonService.formatRon(product.minPrice)}
                          </span>
                        </div>

                        {lowestStore && (
                          <div className="text-right min-w-0">
                            <span className="text-[11px] text-slate-400 block">Magazin</span>
                            <span className="text-xs font-semibold text-slate-800 truncate block">
                              {lowestStore.name}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Clean unboxed metadata */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-slate-500 tabular-nums">
                        <span className="font-medium text-slate-600">
                          {product.offersCount} {product.offersCount === 1 ? 'magazin' : 'magazine'}
                        </span>
                        {product.isPromo && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-700 font-semibold">Promo</span>
                          </>
                        )}
                        {product.loyaltyCardRequired && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 font-medium">Card</span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-2">
                      <span className="text-xs text-slate-500 font-medium block">
                        Nicio ofertă activă verificată
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        În curs de indexare
                      </span>
                    </div>
                  )}

                  {/* Butoane Acțiune */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onSelectProduct(product.id);
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-slate-900 group-hover:bg-emerald-600 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <span>Compară prețuri</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    {(() => {
                      const inList = Boolean(activeList?.items.some(item => item.productId === product.id));
                      return (
                        <button
                          type="button"
                          onClick={e => { void handleQuickAdd(e, product); }}
                          aria-label={`Adaugă ${product.name} în lista mea`}
                          className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                            inList
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700'
                          }`}
                          title={inList ? 'Produs în listă (click pentru +1)' : 'Adaugă în lista mea'}
                        >
                          {inList ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paginare */}
      {productsData.totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {Array.from({ length: productsData.totalPages }).map((_, i) => {
            const pageNumber = i + 1;
            // Show first, last, and current neighbors
            if (
              pageNumber === 1 ||
              pageNumber === productsData.totalPages ||
              Math.abs(pageNumber - currentPage) <= 1
            ) {
              return (
                <button
                  key={pageNumber}
                  onClick={() => setCurrentPage(pageNumber)}
                  className={`w-9 h-9 rounded-xl text-xs font-bold transition-all ${
                    currentPage === pageNumber
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pageNumber}
                </button>
              );
            } else if (
              pageNumber === currentPage - 2 ||
              pageNumber === currentPage + 2
            ) {
              return <span key={pageNumber} className="text-slate-400 text-xs">...</span>;
            }
            return null;
          })}

          <button
            onClick={() => setCurrentPage(p => Math.min(productsData.totalPages, p + 1))}
            disabled={currentPage === productsData.totalPages}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
