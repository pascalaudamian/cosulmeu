import React, { useState, useEffect, useMemo } from 'react';
import {
  Store as StoreIcon,
  MapPin,
  Star,
  Tag,
  ExternalLink,
  ShieldCheck,
  ShoppingBag,
  Search,
  Clock,
  CheckCircle2,
  Globe,
  SlidersHorizontal,
  Building2,
  Sparkles,
  ArrowUpRight
} from 'lucide-react';
import { STORES } from '../data/mockData.js';
import { StorageService } from '../services/StorageService.js';
import { Store, ProductOffer } from '../types.js';

interface StoresViewProps {
  userCity: string;
}

type StoreTypeFilter = 'all' | 'hypermarket' | 'supermarket' | 'discounter' | 'with_offers';

export const StoresView: React.FC<StoresViewProps> = ({ userCity }) => {
  const [stores, setStores] = useState<Store[]>(STORES);
  const [offers, setOffers] = useState<ProductOffer[]>(() => StorageService.getProductOffers());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<StoreTypeFilter>('all');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Sync stores from server endpoint
  useEffect(() => {
    let isMounted = true;
    const fetchStores = async () => {
      try {
        setIsLoading(true);
        const [storesRes, offersRes] = await Promise.all([
          fetch('/api/stores'),
          fetch('/api/catalog/offers')
        ]);

        if (storesRes.ok && isMounted) {
          const data = await storesRes.json();
          if (data.success && Array.isArray(data.stores) && data.stores.length > 0) {
            setStores(data.stores);
          }
        }

        if (offersRes.ok && isMounted) {
          const offersData = await offersRes.json();
          if (offersData.success && Array.isArray(offersData.offers) && offersData.offers.length > 0) {
            setOffers(offersData.offers);
          }
        }
      } catch (err) {
        // Fallback gracefully to STORES and StorageService
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchStores();
    return () => {
      isMounted = false;
    };
  }, []);

  // Deduplicate stores by chain/brand key to ensure every distinct major retailer in Romania is represented cleanly
  const uniqueStores = useMemo(() => {
    const seen = new Set<string>();
    const list: Store[] = [];

    // Prioritize baseline STORES that have full clean URLs
    const combined = [...stores];
    for (const base of STORES) {
      if (!combined.some(c => c.id === base.id || c.slug === base.slug)) {
        combined.push(base);
      }
    }

    for (const s of combined) {
      const key = (s.slug || s.id || s.name)
        .toLowerCase()
        .replace(/-chain$/, '')
        .replace(/^store-/, '')
        .replace(/\s+românia|\s+romania/g, '')
        .trim();

      if (!seen.has(key)) {
        seen.add(key);
        // Ensure officialUrl is present from STORES fallback if needed
        const fallback = STORES.find(bs => bs.id === s.id || bs.slug === s.slug || bs.name.toLowerCase() === s.name.toLowerCase());
        list.push({
          ...s,
          officialUrl: s.officialUrl || s.websiteUrl || fallback?.officialUrl || fallback?.websiteUrl
        });
      }
    }

    return list;
  }, [stores]);

  // Compute offer counts per store (handling both 'lidl' and 'store-lidl' prefixes)
  const offersByStore = useMemo(() => {
    const map = new Map<string, { total: number; promo: number }>();

    for (const store of uniqueStores) {
      const storeKey = (store.slug || store.id || store.name)
        .toLowerCase()
        .replace(/-chain$/, '')
        .replace(/^store-/, '')
        .replace(/\s+românia|\s+romania/g, '')
        .trim();

      let total = 0;
      let promo = 0;

      for (const off of offers) {
        const offKey = (off.storeId || '')
          .toLowerCase()
          .replace(/-chain$/, '')
          .replace(/^store-/, '')
          .replace(/\s+românia|\s+romania/g, '')
          .trim();

        if (offKey === storeKey || off.storeId === store.id || off.storeId === store.slug) {
          total += 1;
          if (off.isPromo) promo += 1;
        }
      }

      map.set(store.id, { total, promo });
    }

    return map;
  }, [uniqueStores, offers]);

  // Filtered stores
  const filteredStores = useMemo(() => {
    return uniqueStores.filter(store => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = store.name.toLowerCase().includes(q);
        const matchesChain = store.chain.toLowerCase().includes(q);
        const matchesAddress = store.sampleAddress.toLowerCase().includes(q);
        const matchesType = store.type.toLowerCase().includes(q);
        if (!matchesName && !matchesChain && !matchesAddress && !matchesType) {
          return false;
        }
      }

      // Type filter
      if (selectedType === 'with_offers') {
        const count = offersByStore.get(store.id)?.total || 0;
        return count > 0;
      }
      if (selectedType !== 'all') {
        return store.type === selectedType;
      }

      return true;
    });
  }, [uniqueStores, searchQuery, selectedType, offersByStore]);

  // Summary counters
  const totalStoresWithOffers = useMemo(() => {
    return uniqueStores.filter(s => (offersByStore.get(s.id)?.total || 0) > 0).length;
  }, [uniqueStores, offersByStore]);

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 tabular-nums">
            {uniqueStores.length} Rețele Monitorizate · {totalStoresWithOffers} cu cataloage active
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mt-1.5">
            Supermarketuri &amp; Retaileri Parteneri
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1.5 max-w-3xl leading-relaxed">
            Rețelele de hipermarketuri, supermarketuri și discounters din România. Apasă pe orice retailer pentru a deschide site-ul oficial și cataloagele actualizate.
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="surface-card p-3.5 sm:p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 flex-1 text-xs focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:border-emerald-500 transition-colors">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder="Caută retailer (ex: Lidl, Selgros, Carrefour, Penny, La Cocoș, Supeco)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold px-1 cursor-pointer"
                title="Șterge căutarea"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar text-xs tabular-nums">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'all'
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Toți ({uniqueStores.length})
            </button>
            <button
              onClick={() => setSelectedType('hypermarket')}
              className={`px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'hypermarket'
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Hipermarketuri
            </button>
            <button
              onClick={() => setSelectedType('supermarket')}
              className={`px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'supermarket'
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Supermarketuri
            </button>
            <button
              onClick={() => setSelectedType('discounter')}
              className={`px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'discounter'
                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Discounters
            </button>
            <button
              onClick={() => setSelectedType('with_offers')}
              className={`px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                selectedType === 'with_offers'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>Indexate ({totalStoresWithOffers})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Retailers Grid */}
      {filteredStores.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
          <StoreIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
            Niciun retailer nu corespunde căutării „{searchQuery}”
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Încearcă să resetezi filtrele sau să cauți după alt termen (ex: Lidl, Kaufland, Auchan, Carrefour, Penny, Selgros).
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedType('all');
            }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 cursor-pointer"
          >
            Resetează toate filtrele
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredStores.map(store => {
            const storeStats = offersByStore.get(store.id) || { total: 0, promo: 0 };
            const storeOffersCount = storeStats.total;
            const promoOffersCount = storeStats.promo;
            const officialUrl = store.officialUrl || store.websiteUrl || 'https://www.google.com/search?q=' + encodeURIComponent(store.name + ' Romania');

            return (
              <div
                key={store.id}
                className="surface-card surface-card-interactive p-5 flex flex-col justify-between group"
              >
                <div>
                  {/* Store Top Header */}
                  <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Clickable Brand Logo/Avatar with direct link to official website */}
                      <a
                        href={officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`w-11 h-11 rounded-xl text-white font-display font-bold text-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 cursor-pointer ${store.brandColor}`}
                        title={`Deschide site-ul oficial ${store.name} într-o filă nouă (${officialUrl})`}
                      >
                        {store.name.charAt(0)}
                      </a>

                      <div className="min-w-0">
                        <a
                          href={officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 leading-tight hover:text-emerald-700 dark:hover:text-emerald-400 inline-flex items-center gap-1.5 group/link cursor-pointer transition-colors max-w-full"
                          title={`Deschide site-ul oficial ${store.name} într-o filă nouă (${officialUrl})`}
                        >
                          <span className="truncate">{store.name}</span>
                          <ArrowUpRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                        </a>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block truncate mt-0.5">
                          {store.chain}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>{store.rating}</span>
                    </div>
                  </div>

                  {/* Characteristics */}
                  <div className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 dark:text-slate-500">Tip magazin</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                        {store.type === 'discounter'
                          ? 'Discounter'
                          : store.type === 'hypermarket'
                          ? 'Hipermarket'
                          : store.type === 'supermarket'
                          ? 'Supermarket'
                          : 'Proximitate'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 dark:text-slate-500">Rețea națională</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                        {store.locationsCount > 1
                          ? `${store.locationsCount}+ unități`
                          : 'Online / Hub central'}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-slate-400 dark:text-slate-500 shrink-0 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Reper
                      </span>
                      <span className="font-medium text-slate-700 dark:text-slate-200 text-right truncate max-w-[190px]">
                        {store.sampleAddress}
                      </span>
                    </div>
                  </div>

                  {/* Active Offers & Indexing Status */}
                  {storeOffersCount > 0 ? (
                    <div className="mt-4 p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60 flex items-center justify-between text-xs tabular-nums">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Produse indexate</span>
                        <span className="font-bold text-emerald-950 dark:text-emerald-300 text-sm">
                          {storeOffersCount} articole
                        </span>
                      </div>
                      {promoOffersCount > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                          <Tag className="w-3 h-3" /> {promoOffersCount} promoții
                        </span>
                      ) : (
                        <span className="text-slate-600 dark:text-slate-300 font-medium text-[11px]">
                          Indexare activă
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs tabular-nums">
                      <div>
                        <span className="text-slate-400 dark:text-slate-500 block text-[11px]">Produse indexate</span>
                        <span className="font-bold text-slate-500 dark:text-slate-300 text-sm">0 articole</span>
                      </div>
                      <span className="text-amber-700 dark:text-amber-400 text-[11px] font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" /> În curs de indexare
                      </span>
                    </div>
                  )}

                  {/* Dedicated Action Button to Official Website */}
                  <a
                    href={officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-3.5 py-2 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-200 hover:text-emerald-800 dark:hover:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors group/btn cursor-pointer"
                    title={`Deschide pagina oficială ${store.name} într-o filă nouă`}
                  >
                    <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover/btn:text-emerald-600 dark:group-hover/btn:text-emerald-400 transition-colors" />
                    <span>Site oficial {store.name}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover/btn:text-emerald-600 dark:group-hover/btn:text-emerald-400 transition-colors" />
                  </a>
                </div>

                {/* Card Footer Status */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                  <span className="flex items-center gap-1.5">
                    {storeOffersCount > 0 ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-slate-600 dark:text-slate-300 font-medium">Catalog verificat</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                        <span className="text-slate-500 dark:text-slate-400">Monitorizare programată</span>
                      </>
                    )}
                  </span>
                  <span className={`text-[11px] font-semibold ${store.isPartner ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {store.isPartner ? 'Partener oficial' : 'Sursă publică'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transparency Note */}
      <div className="mt-8 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-700 dark:text-slate-200 font-bold">Transparență civică & integritate:</strong> Link-urile externe redirecționează direct către site-urile oficiale ale retailerilor din România pentru consultarea promoțiilor actualizate și a termenilor legali din cataloagele naționale. Coșul Meu nu comercializează direct produse și oferă un instrument civic independent de comparare a prețurilor.
        </p>
      </div>
    </div>
  );
};
