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
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-emerald-800 text-xs font-bold mb-2">
            <Building2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{uniqueStores.length} Mari Retaileri din România Monitorizați</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Supermarketuri & Retaileri Parteneri 🏬
          </h1>
          <p className="text-slate-600 text-sm mt-1 max-w-3xl leading-relaxed">
            Toate marile rețele de hipermarketuri, supermarketuri, discounters și retaileri alimentari din România. <strong>Dă click pe numele oricărui retailer</strong> pentru a deschide direct site-ul oficial într-o filă nouă cu ofertele și cataloagele sale actualizate.
          </p>
        </div>

        {/* Quick status summary badge */}
        <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-2xs shrink-0 text-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-slate-700">
            <strong className="text-emerald-700 font-extrabold">{totalStoresWithOffers}</strong> retaileri cu cataloage indexate activ
          </span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex-1 text-xs">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Caută retailer după nume (ex: Lidl, Selgros, Carrefour, Penny, La Cocoș, Supeco)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-400 font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                title="Șterge căutarea"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none text-xs">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'all'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Toți ({uniqueStores.length})
            </button>
            <button
              onClick={() => setSelectedType('hypermarket')}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'hypermarket'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Hipermarketuri
            </button>
            <button
              onClick={() => setSelectedType('supermarket')}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'supermarket'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Supermarketuri
            </button>
            <button
              onClick={() => setSelectedType('discounter')}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors cursor-pointer ${
                selectedType === 'discounter'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Discounters
            </button>
            <button
              onClick={() => setSelectedType('with_offers')}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                selectedType === 'with_offers'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="w-3 h-3 text-emerald-600" />
              <span>Indexate ({totalStoresWithOffers})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Retailers Grid */}
      {filteredStores.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-3">
          <StoreIcon className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-800">
            Niciun retailer nu corespunde căutării „{searchQuery}”
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
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
                className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-emerald-300/80 transition-all duration-200 group"
              >
                <div>
                  {/* Store Top Header */}
                  <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Clickable Brand Logo/Avatar with direct link to official website */}
                      <a
                        href={officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`w-12 h-12 rounded-2xl text-white font-black text-lg flex items-center justify-center shadow-xs shrink-0 transition-transform group-hover:scale-105 cursor-pointer ${store.brandColor}`}
                        title={`Deschide site-ul oficial ${store.name} într-o filă nouă (${officialUrl})`}
                      >
                        {store.name.charAt(0)}
                      </a>

                      <div className="min-w-0">
                        {/* Primary Requirement: Clickable Retailer Name directing in new tab to official website */}
                        <a
                          href={officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-extrabold text-lg text-slate-900 leading-tight hover:text-emerald-700 hover:underline inline-flex items-center gap-1.5 group/link cursor-pointer transition-colors max-w-full"
                          title={`Deschide site-ul oficial ${store.name} într-o filă nouă (${officialUrl})`}
                        >
                          <span className="truncate">{store.name}</span>
                          <ArrowUpRight className="w-4 h-4 text-emerald-600 shrink-0 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                        </a>
                        <span className="text-xs text-slate-400 font-medium block truncate mt-0.5">
                          {store.chain}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-bold text-slate-800 bg-amber-50 border border-amber-200/60 px-2 py-1 rounded-xl shrink-0">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>{store.rating}</span>
                    </div>
                  </div>

                  {/* Characteristics */}
                  <div className="mt-4 space-y-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Tip magazin:</span>
                      <span className="font-semibold text-slate-700 capitalize">
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
                      <span className="text-slate-400">Rețea națională:</span>
                      <span className="font-semibold text-slate-700">
                        {store.locationsCount > 1
                          ? `${store.locationsCount}+ unități în România`
                          : 'Online / Hub central'}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-100">
                      <span className="text-slate-400 shrink-0 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Adresă reper:
                      </span>
                      <span className="font-medium text-slate-800 text-right truncate max-w-[190px]">
                        {store.sampleAddress}
                      </span>
                    </div>
                  </div>

                  {/* Active Offers & Indexing Status Badge */}
                  {storeOffersCount > 0 ? (
                    <div className="mt-4 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Produse indexate</span>
                        <span className="font-extrabold text-emerald-950 text-sm">
                          {storeOffersCount} articole
                        </span>
                      </div>
                      {promoOffersCount > 0 ? (
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1 text-[11px]">
                          <Tag className="w-3 h-3 text-emerald-700" /> {promoOffersCount} promoții active
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl bg-white text-slate-600 border border-slate-200 font-semibold text-[11px]">
                          Indexare activă
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Produse indexate</span>
                        <span className="font-bold text-slate-500 text-sm">0 articole</span>
                      </div>
                      <span className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200/60 text-[11px] font-bold flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-600" /> În curs de indexare
                      </span>
                    </div>
                  )}

                  {/* Dedicated Action Button to Official Website */}
                  <a
                    href={officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-3.5 py-2 px-3.5 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/70 text-slate-700 hover:text-emerald-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-all group/btn cursor-pointer shadow-2xs"
                    title={`Deschide pagina oficială ${store.name} într-o filă nouă`}
                  >
                    <Globe className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-emerald-600 transition-colors" />
                    <span>Vizitează site-ul oficial {store.name}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-emerald-600 transition-colors" />
                  </a>
                </div>

                {/* Card Footer Status */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    {storeOffersCount > 0 ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-slate-600 font-medium">Catalog verificat</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-500">Monitorizare programată</span>
                      </>
                    )}
                  </span>
                  {store.isPartner ? (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                      Partener oficial
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      Sursă publică
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transparency Note */}
      <div className="mt-8 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-700 font-bold">Transparență civică & integritate:</strong> Link-urile externe redirecționează direct către site-urile oficiale ale retailerilor din România pentru consultarea promoțiilor actualizate și a termenilor legali din cataloagele naționale. Coșul Meu nu comercializează direct produse și oferă un instrument civic independent de comparare a prețurilor.
        </p>
      </div>
    </div>
  );
};
