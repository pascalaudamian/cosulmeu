import React from 'react';
import { Store as StoreIcon, MapPin, Star, Tag, ExternalLink, ShieldCheck, ShoppingBag } from 'lucide-react';
import { STORES } from '../data/mockData';
import { PRODUCT_OFFERS } from '../data/mockData';

interface StoresViewProps {
  userCity: string;
}

export const StoresView: React.FC<StoresViewProps> = ({ userCity }) => {
  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Supermarketuri & Retaileri Parteneri 🏬
        </h1>
        <p className="text-slate-600 text-sm mt-0.5">
          Rețelele de magazine monitorizate pentru comparații de preț și oferte în {userCity}.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {STORES.map(store => {
          const storeOffersCount = PRODUCT_OFFERS.filter(o => o.storeId === store.id).length;
          const promoOffersCount = PRODUCT_OFFERS.filter(o => o.storeId === store.id && o.isPromo).length;

          return (
            <div
              key={store.id}
              className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                {/* Store Top Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-2xl text-white font-black text-lg flex items-center justify-center shadow-xs ${store.brandColor}`}
                    >
                      {store.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-lg text-slate-900 leading-tight">
                        {store.name}
                      </h3>
                      <span className="text-xs text-slate-400 font-medium">{store.chain}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-xs font-bold text-slate-800 bg-amber-50 border border-amber-200/60 px-2 py-1 rounded-xl">
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
                    <span className="text-slate-400">Magazine în România:</span>
                    <span className="font-semibold text-slate-700">{store.locationsCount}+ unități</span>
                  </div>

                  <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-100">
                    <span className="text-slate-400 shrink-0 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Adresă reper:
                    </span>
                    <span className="font-medium text-slate-800 text-right truncate">
                      {store.sampleAddress}
                    </span>
                  </div>
                </div>

                {/* Active Offers Badge */}
                <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500 block">Produse indexate</span>
                    <span className="font-bold text-slate-900">{storeOffersCount} articole</span>
                  </div>
                  {promoOffersCount > 0 && (
                    <span className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1">
                      <Tag className="w-3 h-3" /> {promoOffersCount} promoții active
                    </span>
                  )}
                </div>
              </div>

              {/* Footer status */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Catalog verificat
                </span>
                {store.isPartner && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Partener oficial
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
