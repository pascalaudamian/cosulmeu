import React, { useState } from 'react';
import {
  ShoppingBasket,
  Bell,
  MapPin,
  ChevronDown,
  Check,
  Sparkles,
  TrendingDown,
  ShoppingBag,
  LogIn,
  UserPlus,
  ShieldAlert,
  LogOut,
  SlidersHorizontal,
  User
} from 'lucide-react';
import { ROMANIAN_CITIES } from '../data/mockData.js';
import { UserProfile, PriceAlert } from '../types.js';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onSignOut?: () => Promise<void>;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  alerts: PriceAlert[];
  itemsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  userProfile,
  onUpdateProfile,
  onSignOut,
  isAuthenticated = false,
  isAdmin = false,
  alerts,
  itemsCount
}) => {
  const [showCityMenu, setShowCityMenu] = useState(false);
  const [showAlertsMenu, setShowAlertsMenu] = useState(false);

  const activeAlerts = alerts.filter(a => a.isActive);
  const avatarSrc = userProfile.avatarUrl || userProfile.avatar_url;
  const userRole = userProfile.role || (isAdmin ? 'admin' : 'user');

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="hidden md:block border-b border-slate-100 bg-slate-50/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>Prețuri actualizate pentru cumpărături mai inteligente</span>
          <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-emerald-600" />{userProfile.city}</span>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex items-center justify-between gap-3">
        {/* Brand Logo */}
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          aria-label="Mergi la pagina principală Coșul Meu"
          className="flex items-center gap-2.5 cursor-pointer group shrink-0 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <ShoppingBasket className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900">
                Coșul<span className="text-emerald-600">Meu</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
              Economisește la supermarket
            </p>
          </div>
        </button>

        {/* Desktop Nav Links */}
        <nav aria-label="Navigație principală" className="hidden md:flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto lg:gap-2">
          <button
            onClick={() => onSelectTab('dashboard')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              currentTab === 'dashboard'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Acasă
          </button>
          <button
            onClick={() => onSelectTab('products')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
              currentTab === 'products' || currentTab === 'product-detail'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Produse
          </button>
          <button
            onClick={() => onSelectTab('shopping-list')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
              currentTab === 'shopping-list'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Lista mea
            {itemsCount > 0 && (
              <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {itemsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => onSelectTab('compare')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
              currentTab === 'compare'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Compară prețuri
          </button>
          <button
            onClick={() => onSelectTab('scan-receipt')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              currentTab === 'scan-receipt' || currentTab === 'receipts'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Bonuri
          </button>
          <button
            onClick={() => onSelectTab('price-history')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              currentTab === 'price-history'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Evoluție prețuri
          </button>
          <button
            onClick={() => onSelectTab('stores')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              currentTab === 'stores'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Magazine
          </button>

          {/* Admin link if user is administrator */}
          {(userRole === 'admin' || isAdmin) && (
            <button
              onClick={() => onSelectTab('admin-sources')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                currentTab === 'admin-sources' || currentTab === 'admin-quality'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Admin Cataloage</span>
            </button>
          )}
        </nav>

        {/* Right Section: City Selector, Alerts, and Auth Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* City Selector */}
          <div className="relative">
            <button
              onClick={() => setShowCityMenu(!showCityMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="hidden sm:inline max-w-[110px] truncate">{userProfile.city}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showCityMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Selectează orașul
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {ROMANIAN_CITIES.map(c => (
                    <button
                      key={c}
                      onClick={() => {
                        onUpdateProfile({ ...userProfile, city: c });
                        setShowCityMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${
                        userProfile.city === c ? 'text-emerald-700 font-bold bg-emerald-50/50' : 'text-slate-700'
                      }`}
                    >
                      <span>{c}</span>
                      {userProfile.city === c && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Price Alerts Bell */}
          <div className="relative">
            <button
              onClick={() => setShowAlertsMenu(!showAlertsMenu)}
              className="relative p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
              title="Alerte de preț active"
            >
              <Bell className="w-4 h-4" />
              {activeAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {activeAlerts.length}
                </span>
              )}
            </button>

            {showAlertsMenu && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-xl border border-slate-100 py-3 px-3 z-50 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                  <span className="text-xs font-bold text-slate-900">Alerte de preț active</span>
                  <button
                    onClick={() => {
                      onSelectTab('price-history');
                      setShowAlertsMenu(false);
                    }}
                    className="text-[11px] text-emerald-700 font-semibold hover:underline"
                  >
                    Vezi toate
                  </button>
                </div>

                {activeAlerts.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">Nu ai alerte active în acest moment.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {activeAlerts.map(alert => (
                      <div
                        key={alert.id}
                        onClick={() => {
                          onSelectTab('price-history');
                          setShowAlertsMenu(false);
                        }}
                        className="p-2 rounded-xl bg-slate-50 hover:bg-emerald-50/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-800 line-clamp-1">
                            {alert.productName}
                          </span>
                          <TrendingDown className="w-3.5 h-3.5 text-emerald-600 shrink-0 ml-1" />
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-slate-600">
                          <span>Țintă: {alert.targetPrice.toFixed(2)} lei</span>
                          <span className="font-bold text-emerald-700">
                            Acum: {alert.currentLowestPrice.toFixed(2)} lei
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User Profile / Auth State */}
          {isAuthenticated ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => onSelectTab('profile')}
                className={`flex items-center gap-2 p-1 sm:px-2.5 sm:py-1.5 rounded-xl border transition-colors ${
                  currentTab === 'profile'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center overflow-hidden shrink-0">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt={userProfile.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{userProfile.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="hidden lg:flex flex-col text-left">
                  <span className="text-xs font-bold text-slate-800 max-w-[90px] truncate leading-tight">
                    {userProfile.name}
                  </span>
                  {userRole === 'admin' && (
                    <span className="text-[9px] font-black text-purple-700 uppercase tracking-tighter">
                      Admin
                    </span>
                  )}
                </div>
              </button>

              {onSignOut && (
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border border-transparent hover:border-red-200 hover:bg-red-50 text-slate-500 hover:text-red-700 text-xs font-bold flex items-center gap-1 transition-colors"
                  title="Ieșire din cont"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Ieșire</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => onSelectTab('auth')}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-slate-700 hover:text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <LogIn className="w-3.5 h-3.5 text-emerald-600" />
                <span>Autentificare</span>
              </button>
              <button
                onClick={() => onSelectTab('auth')}
                className="hidden sm:inline-flex px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-xs shadow-emerald-600/20 transition-colors"
              >
                Cont nou
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
