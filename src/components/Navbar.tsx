import React, { useState } from 'react';
import { ShoppingBasket, Bell, MapPin, ChevronDown, Check, Sparkles, TrendingDown } from 'lucide-react';
import { ROMANIAN_CITIES } from '../data/mockData';
import { UserProfile, PriceAlert } from '../types';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  alerts: PriceAlert[];
  itemsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  userProfile,
  onUpdateProfile,
  alerts,
  itemsCount
}) => {
  const [showCityMenu, setShowCityMenu] = useState(false);
  const [showAlertsMenu, setShowAlertsMenu] = useState(false);

  const activeAlerts = alerts.filter(a => a.isActive);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div
          onClick={() => onSelectTab('dashboard')}
          className="flex items-center gap-2.5 cursor-pointer group shrink-0"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <ShoppingBasket className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900">
                Coșul<span className="text-emerald-600">Meu</span>
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                RO
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
              Economisește la supermarket
            </p>
          </div>
        </div>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
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
          <button
            onClick={() => onSelectTab('admin-sources')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
              currentTab === 'admin-sources'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Surse date
          </button>
        </nav>

        {/* Right Actions: City Selector + Notifications + Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* City Selector */}
          <div className="relative">
            <button
              onClick={() => {
                setShowCityMenu(!showCityMenu);
                setShowAlertsMenu(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs sm:text-sm font-medium text-slate-700 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="max-w-[110px] sm:max-w-[140px] truncate">{userProfile.city}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {showCityMenu && (
              <div className="absolute right-0 mt-2 w-56 max-h-72 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Alege orașul / zona
                </div>
                {ROMANIAN_CITIES.map(city => (
                  <button
                    key={city}
                    onClick={() => {
                      onUpdateProfile({ ...userProfile, city });
                      setShowCityMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between"
                  >
                    <span>{city}</span>
                    {userProfile.city === city && <Check className="w-4 h-4 text-emerald-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notifications / Alerts Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowAlertsMenu(!showAlertsMenu);
                setShowCityMenu(false);
              }}
              className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="Alerte de preț"
            >
              <Bell className="w-5 h-5" />
              {activeAlerts.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white"></span>
              )}
            </button>

            {showAlertsMenu && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                  <span className="font-semibold text-sm text-slate-900">Alerte active ({activeAlerts.length})</span>
                  <button
                    onClick={() => {
                      onSelectTab('price-history');
                      setShowAlertsMenu(false);
                    }}
                    className="text-xs text-emerald-600 hover:underline font-medium"
                  >
                    Vezi toate
                  </button>
                </div>
                {activeAlerts.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Nu ai nicio alertă activă de preț în acest moment.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {activeAlerts.map(alert => (
                      <div
                        key={alert.id}
                        onClick={() => {
                          onSelectTab('price-history');
                          setShowAlertsMenu(false);
                        }}
                        className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100 hover:bg-emerald-100/60 cursor-pointer transition-colors"
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

          {/* User Profile avatar */}
          <button
            onClick={() => onSelectTab('profile')}
            className={`flex items-center gap-2 p-1 sm:px-2.5 sm:py-1.5 rounded-lg border transition-colors ${
              currentTab === 'profile'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center">
              {userProfile.name.charAt(0)}
            </div>
            <span className="text-xs font-semibold hidden lg:inline max-w-[80px] truncate">
              {userProfile.name}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
