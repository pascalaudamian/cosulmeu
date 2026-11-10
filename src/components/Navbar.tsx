import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  LogOut,
  SlidersHorizontal,
  User,
  Menu,
  X,
  ReceiptText,
  Store as StoreIcon,
  LineChart,
  Search
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
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [drawerCityPickerOpen, setDrawerCityPickerOpen] = useState(false);

  const cityMenuRef = useRef<HTMLDivElement>(null);
  const alertsMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const activeAlerts = alerts.filter(a => a.isActive);
  const avatarSrc = userProfile.avatarUrl || userProfile.avatar_url;
  const isUserAdmin = Boolean(isAdmin || userProfile.role === 'admin');

  // Filter Romanian cities based on search input
  const filteredCities = ROMANIAN_CITIES.filter(city =>
    city.toLowerCase().includes(citySearchQuery.trim().toLowerCase())
  );

  // Close desktop menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (cityMenuRef.current && !cityMenuRef.current.contains(target)) {
        setShowCityMenu(false);
      }
      if (alertsMenuRef.current && !alertsMenuRef.current.contains(target)) {
        setShowAlertsMenu(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setShowProfileMenu(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCityMenu(false);
        setShowAlertsMenu(false);
        setShowProfileMenu(false);
        setShowMoreMenu(false);
        setIsMobileDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileDrawerOpen]);

  const closeAllMenus = () => {
    setShowCityMenu(false);
    setShowAlertsMenu(false);
    setShowProfileMenu(false);
    setShowMoreMenu(false);
  };

  const handleNavigate = (tab: string) => {
    onSelectTab(tab);
    closeAllMenus();
    setIsMobileDrawerOpen(false);
  };

  const isMoreTabActive = ['receipts', 'scan-receipt', 'stores', 'price-history'].includes(currentTab);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
      {/* =========================================================================
          NIVELUL 1: UTILITY BAR (BANDA DE SUS) — Desktop, Tablet & Mobil
          Elemente: Locație („București”), Alerte preț, Profil / Autentificare
         ========================================================================= */}
      <div className="relative z-30 border-b border-slate-100 bg-slate-50/90 py-1.5 transition-colors">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-slate-600 font-medium">
          {/* Left: Info de încredere */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 hidden sm:inline">Comparator independent</span>
            <span className="text-slate-300 hidden sm:inline">·</span>
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              8 retaileri
            </span>
            <span className="text-slate-400 hidden md:inline">· Catalog live actualizat</span>
          </div>

          {/* Right: Utility Elements */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* 1. Selector Locație */}
            <div className="relative" ref={cityMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setShowCityMenu(!showCityMenu);
                  setShowAlertsMenu(false);
                  setShowProfileMenu(false);
                  setShowMoreMenu(false);
                }}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  showCityMenu
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
                aria-label={`Schimbă orașul: curent ${userProfile.city}`}
                aria-expanded={showCityMenu}
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="max-w-[85px] sm:max-w-[120px] truncate">{userProfile.city}</span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showCityMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Meniu Dropdown Locație Desktop (ancorat direct sub buton) */}
              {showCityMenu && (
                <div
                  role="menu"
                  aria-label="Meniu selecție oraș"
                  className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95"
                >
                  <div className="px-2 pt-1 pb-2 border-b border-slate-100 flex items-center justify-between">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Selectează orașul
                    </div>
                  </div>

                  {/* Căutare rapidă oraș */}
                  <div className="relative my-2 px-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Caută orașul tău..."
                      value={citySearchQuery}
                      onChange={e => setCitySearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-emerald-600 bg-slate-50 focus:bg-white"
                      autoFocus
                    />
                  </div>

                  {/* Listă orașe cu scroll */}
                  <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                    {filteredCities.length === 0 ? (
                      <div className="text-xs text-slate-400 py-4 text-center">Niciun oraș găsit</div>
                    ) : (
                      filteredCities.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            onUpdateProfile({ ...userProfile, city: c });
                            setShowCityMenu(false);
                            setCitySearchQuery('');
                          }}
                          className={`w-full text-left px-3 py-2 text-xs rounded-xl flex items-center justify-between transition-colors cursor-pointer ${
                            userProfile.city === c
                              ? 'text-emerald-800 font-bold bg-emerald-50'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{c}</span>
                          {userProfile.city === c && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="h-3.5 w-px bg-slate-200" aria-hidden="true" />

            {/* 2. Price Alerts Bell */}
            <div className="relative" ref={alertsMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setShowAlertsMenu(!showAlertsMenu);
                  setShowCityMenu(false);
                  setShowProfileMenu(false);
                  setShowMoreMenu(false);
                }}
                className={`relative p-1.5 rounded-lg border transition-all cursor-pointer ${
                  showAlertsMenu
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                }`}
                title="Alerte de preț active"
                aria-label="Alerte de preț"
                aria-expanded={showAlertsMenu}
              >
                <Bell className="w-3.5 h-3.5" />
                {activeAlerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center shadow-xs">
                    {activeAlerts.length}
                  </span>
                )}
              </button>

              {showAlertsMenu && (
                <div
                  role="menu"
                  aria-label="Alerte de preț active"
                  className="absolute right-0 top-full mt-1.5 w-76 sm:w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 z-50 animate-in fade-in zoom-in-95"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                    <span className="text-xs font-bold text-slate-900">Alerte de preț active</span>
                    <button
                      type="button"
                      onClick={() => handleNavigate('price-history')}
                      className="text-[11px] text-emerald-700 font-semibold hover:underline cursor-pointer"
                    >
                      Vezi toate
                    </button>
                  </div>

                  {activeAlerts.length === 0 ? (
                    <div className="text-center py-4 px-2">
                      <p className="text-xs text-slate-500 font-medium">Nu ai nicio alertă de preț activă.</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Adaugă alerte din catalogul de produse.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {activeAlerts.map(alert => (
                        <div
                          key={alert.id}
                          onClick={() => handleNavigate('price-history')}
                          className="p-2 rounded-xl bg-slate-50 hover:bg-emerald-50/60 cursor-pointer transition-colors border border-slate-100"
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

            <div className="h-3.5 w-px bg-slate-200" aria-hidden="true" />

            {/* 3. Autentificare / Contul meu */}
            {isAuthenticated ? (
              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(!showProfileMenu);
                    setShowCityMenu(false);
                    setShowAlertsMenu(false);
                    setShowMoreMenu(false);
                  }}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                    showProfileMenu || currentTab === 'profile'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                  aria-label="Meniu profil utilizator"
                  aria-expanded={showProfileMenu}
                >
                  <div className="w-5 h-5 rounded-full bg-slate-800 text-white font-bold text-[10px] flex items-center justify-center overflow-hidden shrink-0">
                    {avatarSrc ? (
                      <img src={avatarSrc} alt={userProfile.name} className="w-full h-full object-cover" />
                    ) : (
                      <span>{userProfile.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="text-xs font-semibold max-w-[80px] sm:max-w-[110px] truncate text-slate-800">
                    {userProfile.name.split(' ')[0]}
                  </span>
                  {isUserAdmin && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded hidden sm:inline">
                      Admin
                    </span>
                  )}
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} />
                </button>

                {showProfileMenu && (
                  <div
                    role="menu"
                    aria-label="Meniu cont utilizator"
                    className="absolute right-0 top-full mt-1.5 w-60 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95"
                  >
                    {/* Antet Utilizator */}
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">{userProfile.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">{userProfile.email || 'Utilizator conectat'}</div>
                      </div>
                      {isUserAdmin && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          Admin
                        </span>
                      )}
                    </div>

                    {/* Legături Client */}
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => handleNavigate('profile')}
                        className={`w-full text-left px-3 py-2 text-xs rounded-xl flex items-center gap-2 transition-colors cursor-pointer ${
                          currentTab === 'profile' ? 'text-emerald-700 font-bold bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span>Profilul meu & Setări</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate('shopping-list')}
                        className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center justify-between text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <ShoppingBag className="w-3.5 h-3.5 text-slate-500" />
                          <span>Lista de cumpărături</span>
                        </span>
                        {itemsCount > 0 && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 rounded-full">
                            {itemsCount}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate('price-history')}
                        className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <Bell className="w-3.5 h-3.5 text-slate-500" />
                        <span>Alerte de preț</span>
                      </button>
                    </div>

                    {/* MUTAREA SECȚIUNII ADMIN */}
                    {isUserAdmin && (
                      <div className="border-t border-slate-100 pt-1 pb-1 mt-1 bg-slate-50/60 rounded-xl px-1">
                        <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Administrare
                        </div>
                        <button
                          type="button"
                          onClick={() => handleNavigate('admin-sources')}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 font-medium transition-colors cursor-pointer ${
                            currentTab === 'admin-sources'
                              ? 'text-emerald-800 bg-emerald-100/80 font-bold'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Panou Admin Cataloage</span>
                        </button>
                      </div>
                    )}

                    {/* Ieșire din cont */}
                    {onSignOut && (
                      <div className="border-t border-slate-100 pt-1 mt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowProfileMenu(false);
                            void onSignOut();
                          }}
                          className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors font-medium cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5 text-red-500" />
                          <span>Ieșire din cont</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Secondary CTA */}
                <button
                  type="button"
                  onClick={() => handleNavigate('auth')}
                  className="px-2 sm:px-2.5 py-1 rounded-lg border border-slate-200 bg-transparent hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-slate-500" />
                  <span>Autentificare</span>
                </button>

                {/* Primary CTA */}
                <button
                  type="button"
                  onClick={() => handleNavigate('auth')}
                  className="hidden sm:inline-flex px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  Cont nou
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          NIVELUL 2: MAIN NAVIGATION (BANDA PRINCIPALĂ)
          Paginile esențiale: Acasă, Produse, Lista mea, Compară prețuri, Bonuri, Magazine
          CTA Primar Solid: "Compară coșul"
         ========================================================================= */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo & Wordmark */}
        <button
          type="button"
          onClick={() => handleNavigate('dashboard')}
          aria-label="Mergi la pagina principală Coșul Meu"
          className="flex items-center gap-2.5 cursor-pointer group shrink-0 text-left focus-visible:outline-emerald-600"
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
            <p className="text-[11px] text-slate-500 font-medium hidden sm:block leading-none">
              Economisește la supermarket
            </p>
          </div>
        </button>

        {/* -----------------------------------------------------------------------
            DESKTOP MAIN NAV (> 1024px / lg:flex)
           ----------------------------------------------------------------------- */}
        <nav aria-label="Navigație principală" className="hidden lg:flex items-center gap-1 xl:gap-2">
          {/* Acasă */}
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              currentTab === 'dashboard'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Acasă
          </button>

          {/* Produse */}
          <button
            type="button"
            onClick={() => handleNavigate('products')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              currentTab === 'products' || currentTab === 'product-detail'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShoppingBag className="w-4 h-4 text-slate-500" />
            <span>Produse</span>
          </button>

          {/* Lista mea */}
          <button
            type="button"
            onClick={() => handleNavigate('shopping-list')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              currentTab === 'shopping-list'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>Lista mea</span>
            {itemsCount > 0 && (
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-1.5 py-0.2 rounded-full min-w-[18px] text-center">
                {itemsCount}
              </span>
            )}
          </button>

          {/* Compară prețuri */}
          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              currentTab === 'compare'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>Compară prețuri</span>
          </button>

          {/* Bonuri */}
          <button
            type="button"
            onClick={() => handleNavigate('receipts')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              currentTab === 'receipts' || currentTab === 'scan-receipt'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ReceiptText className="w-4 h-4 text-slate-500" />
            <span>Bonuri</span>
          </button>

          {/* Magazine */}
          <button
            type="button"
            onClick={() => handleNavigate('stores')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              currentTab === 'stores'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <StoreIcon className="w-4 h-4 text-slate-500" />
            <span>Magazine</span>
          </button>
        </nav>

        {/* -----------------------------------------------------------------------
            TABLET MAIN NAV (768px – 1024px / md:flex lg:hidden)
           ----------------------------------------------------------------------- */}
        <nav aria-label="Navigație tabletă" className="hidden md:flex lg:hidden items-center gap-1">
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              currentTab === 'dashboard'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Acasă
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('products')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              currentTab === 'products' || currentTab === 'product-detail'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Produse
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('shopping-list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap ${
              currentTab === 'shopping-list'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>Lista</span>
            {itemsCount > 0 && (
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {itemsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              currentTab === 'compare'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Compară
          </button>

          {/* Dropdown "Mai multe ▾" pe tabletă */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(!showMoreMenu);
                setShowCityMenu(false);
                setShowAlertsMenu(false);
                setShowProfileMenu(false);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                isMoreTabActive || showMoreMenu
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>Mai multe</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-2xl shadow-2xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95">
                <button
                  type="button"
                  onClick={() => handleNavigate('receipts')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                    currentTab === 'receipts' || currentTab === 'scan-receipt'
                      ? 'text-emerald-700 font-bold bg-emerald-50'
                      : 'text-slate-700'
                  }`}
                >
                  <ReceiptText className="w-3.5 h-3.5 text-slate-500" />
                  <span>Bonuri fiscale</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('stores')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                    currentTab === 'stores' ? 'text-emerald-700 font-bold bg-emerald-50' : 'text-slate-700'
                  }`}
                >
                  <StoreIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>Magazine partenere</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('price-history')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                    currentTab === 'price-history' ? 'text-emerald-700 font-bold bg-emerald-50' : 'text-slate-700'
                  }`}
                >
                  <LineChart className="w-3.5 h-3.5 text-slate-500" />
                  <span>Evoluție prețuri</span>
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* -----------------------------------------------------------------------
            RIGHT ACTION ZONE
            Desktop/Tablet: Single Solid Primary CTA "Compară coșul"
            Mobile: CTA rapid + Buton Hamburger Meniu
           ----------------------------------------------------------------------- */}
        <div className="flex items-center gap-2">
          {/* Buton Primar Solid "Compară coșul" (Desktop & Tabletă) */}
          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs shadow-emerald-600/20 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4 fill-white" />
            <span>Compară coșul</span>
          </button>

          {/* Buton Primar Compact "Compară" pe Mobil (< 768px) */}
          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 fill-white" />
            <span>Compară</span>
          </button>

          {/* Buton Hamburger Meniu Mobil */}
          <button
            type="button"
            onClick={() => {
              closeAllMenus();
              setIsMobileDrawerOpen(true);
            }}
            className="md:hidden p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
            aria-label="Deschide meniul principal"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* =========================================================================
          MOBILE SLIDE-OVER DRAWER (PENTRU MOBIL < 768px)
          Renders via createPortal to document.body so it is NEVER squished or trapped!
         ========================================================================= */}
      {isMobileDrawerOpen && typeof document !== 'undefined' && createPortal(
        <div className="md:hidden fixed inset-0 z-[999] overflow-hidden" role="dialog" aria-modal="true">
          {/* Backdrop cu fundal semi-transparent */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Panoul Drawer: Ocupă 100% din înălțimea viewport-ului mobil (100dvh) */}
          <aside className="fixed inset-y-0 right-0 max-w-xs w-full bg-white shadow-2xl flex flex-col z-[1000] h-screen max-h-[100dvh] animate-in slide-in-from-right duration-200">
            {/* Drawer Header (Fix sus) */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs">
                  <ShoppingBasket className="w-4 h-4" />
                </div>
                <span className="font-extrabold text-base tracking-tight text-slate-900">
                  Coșul<span className="text-emerald-600">Meu</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Închide meniul"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body: Scrollabil cu tot conținutul și toate secțiunile */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* User Account / Auth Card */}
              {isAuthenticated ? (
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center overflow-hidden shrink-0">
                      {avatarSrc ? (
                        <img src={avatarSrc} alt={userProfile.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{userProfile.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate">{userProfile.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{userProfile.email}</div>
                    </div>
                  </div>
                  {isUserAdmin && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                      Admin
                    </span>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 flex flex-col gap-2.5">
                  <span className="text-xs text-slate-700 font-semibold">Contul tău Coșul Meu</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleNavigate('auth')}
                      className="flex-1 py-2 text-center text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs transition-colors cursor-pointer"
                    >
                      Autentificare
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNavigate('auth')}
                      className="flex-1 py-2 text-center text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                    >
                      Cont nou
                    </button>
                  </div>
                </div>
              )}

              {/* Oraș selectat în Drawer cu picker inline */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Oraș selectat pentru oferte
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerCityPickerOpen(!drawerCityPickerOpen)}
                  className="w-full flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    {userProfile.city}
                  </span>
                  <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                    Schimbă <ChevronDown className={`w-3 h-3 transition-transform ${drawerCityPickerOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {/* Inline City List if expanded */}
                {drawerCityPickerOpen && (
                  <div className="mt-2 border border-slate-200 rounded-xl bg-white max-h-44 overflow-y-auto divide-y divide-slate-100 shadow-inner">
                    {ROMANIAN_CITIES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          onUpdateProfile({ ...userProfile, city: c });
                          setDrawerCityPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                          userProfile.city === c ? 'text-emerald-800 font-bold bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span>{c}</span>
                        {userProfile.city === c && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Navigation Links — TOATE PAGINILE ESENȚIALE */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Meniu principal
                </div>
                <nav className="space-y-1">
                  <button
                    type="button"
                    onClick={() => handleNavigate('dashboard')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'dashboard' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ShoppingBasket className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Acasă</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('products')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'products' || currentTab === 'product-detail'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Produse & Categorii</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('shopping-list')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                      currentTab === 'shopping-list' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <ShoppingBag className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Lista mea de cumpărături</span>
                    </span>
                    {itemsCount > 0 && (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {itemsCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('compare')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'compare' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Compară prețuri supermarket</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('receipts')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'receipts' || currentTab === 'scan-receipt'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ReceiptText className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Bonuri fiscale & Scanare</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('stores')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'stores' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <StoreIcon className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Magazine partenere</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('price-history')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                      currentTab === 'price-history' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <LineChart className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Evoluție prețuri & Alerte</span>
                    </span>
                    {activeAlerts.length > 0 && (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {activeAlerts.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('profile')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'profile' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <User className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Profilul meu & Setări</span>
                  </button>
                </nav>
              </div>

              {/* MUTAREA SECȚIUNII ADMIN ÎN DRAWER */}
              {isUserAdmin && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span>Administrare sistem</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleNavigate('admin-sources')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'admin-sources'
                        ? 'bg-emerald-100 text-emerald-900 font-bold'
                        : 'bg-slate-50 text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Panou Admin Cataloage</span>
                  </button>
                </div>
              )}
            </div>

            {/* Drawer Footer (Fix jos) */}
            {isAuthenticated && onSignOut && (
              <div className="p-4 border-t border-slate-100 shrink-0 bg-slate-50">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    void onSignOut();
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-red-500" />
                  <span>Ieșire din cont</span>
                </button>
              </div>
            )}
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
};
