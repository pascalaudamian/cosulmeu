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
  Search,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';
import { ROMANIAN_CITIES } from '../data/mockData.js';
import { UserProfile, PriceAlert, InAppPriceNotification, ThemeMode } from '../types.js';
import { getNextQuickToggleTheme } from '../services/ThemeService.js';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onPrefetchTab?: (tab: string) => void;
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onSignOut?: () => Promise<void>;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  alerts: PriceAlert[];
  notifications?: InAppPriceNotification[];
  onMarkNotificationRead?: (id: string) => void;
  itemsCount: number;
  themeMode?: ThemeMode;
  isDarkMode?: boolean;
  onChangeTheme?: (theme: ThemeMode) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  onPrefetchTab,
  userProfile,
  onUpdateProfile,
  onSignOut,
  isAuthenticated = false,
  isAdmin = false,
  alerts,
  notifications = [],
  onMarkNotificationRead,
  itemsCount,
  themeMode = 'light',
  isDarkMode = false,
  onChangeTheme
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
  const unreadNotifications = notifications.filter(n => !n.isRead);
  const bellCount = unreadNotifications.length > 0 ? unreadNotifications.length : activeAlerts.length;
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

  const prefetch = (tab: string) => {
    onPrefetchTab?.(tab);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/75 dark:border-slate-800 transition-colors">
      {/* Utility Bar */}
      <div className="relative z-30 border-b border-slate-100/90 dark:border-slate-800/80 bg-slate-50/75 dark:bg-slate-950/70 py-1.5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
          {/* Left: Info de încredere */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300 hidden sm:inline">Comparator independent</span>
            <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">8 retaileri naționali</span>
            <span className="text-slate-300 dark:text-slate-700 hidden md:inline" aria-hidden="true">·</span>
            <span className="text-slate-500 dark:text-slate-400 hidden md:inline">Catalog actualizat</span>
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
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
                aria-label={`Schimbă orașul: curent ${userProfile.city}`}
                aria-expanded={showCityMenu}
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="max-w-[85px] sm:max-w-[120px] truncate">{userProfile.city}</span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showCityMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Meniu Dropdown Locație Desktop (ancorat direct sub buton) */}
              {showCityMenu && (
                <div
                  role="menu"
                  aria-label="Meniu selecție oraș"
                  className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-2 z-50 animate-in fade-in zoom-in-95"
                >
                  <div className="px-2 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
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
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-emerald-600 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
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
                              ? 'text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>{c}</span>
                          {userProfile.city === c && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {onChangeTheme && (
              <>
                <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onChangeTheme(getNextQuickToggleTheme(themeMode, isDarkMode))}
                  className="flex items-center gap-1.5 p-1.5 sm:px-2 sm:py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  title={isDarkMode ? 'Comută la tema luminoasă' : 'Comută la tema întunecată'}
                  aria-label={isDarkMode ? 'Comută la tema luminoasă' : 'Comută la tema întunecată'}
                  aria-pressed={isDarkMode}
                >
                  {isDarkMode ? (
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-slate-600" />
                  )}
                  <span className="hidden xl:inline text-[11px] font-semibold">
                    {isDarkMode ? 'Luminos' : 'Întunecat'}
                  </span>
                </button>
              </>
            )}

            <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

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
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
                title="Alerte de preț active"
                aria-label="Alerte de preț"
                aria-expanded={showAlertsMenu}
              >
                <Bell className="w-3.5 h-3.5" />
                {bellCount > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 text-white text-[9px] font-bold min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center shadow-xs ${
                      unreadNotifications.length > 0 ? 'bg-rose-600' : 'bg-emerald-600'
                    }`}
                  >
                    {bellCount}
                  </span>
                )}
              </button>

              {showAlertsMenu && (
                <div
                  role="menu"
                  aria-label="Alerte și notificări de preț"
                  className="absolute right-0 top-full mt-1.5 w-76 sm:w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3 z-50 animate-in fade-in zoom-in-95"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Notificări &amp; Alerte ({unreadNotifications.length} noi)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleNavigate('price-history')}
                      className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                    >
                      Vezi toate
                    </button>
                  </div>

                  {unreadNotifications.length > 0 && (
                    <div className="space-y-1.5 mb-2.5 pb-2 border-b border-slate-100 dark:border-slate-800 max-h-40 overflow-y-auto">
                      {unreadNotifications.slice(0, 5).map(notif => (
                        <div
                          key={notif.id}
                          className="p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60 flex items-start justify-between gap-2"
                        >
                          <div
                            onClick={() => handleNavigate('price-history')}
                            className="min-w-0 cursor-pointer"
                          >
                            <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200 block line-clamp-1">
                              {notif.title}
                            </span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-300 block line-clamp-2">
                              {notif.message}
                            </span>
                          </div>
                          {onMarkNotificationRead && (
                            <button
                              type="button"
                              onClick={() => onMarkNotificationRead(notif.id)}
                              className="p-1 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded cursor-pointer shrink-0"
                              title="Marchează citit"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeAlerts.length === 0 ? (
                    <div className="text-center py-4 px-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Nu ai nicio alertă de preț activă.</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Adaugă alerte din catalog sau din lista ta.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {activeAlerts.map(alert => (
                        <div
                          key={alert.id}
                          onClick={() => handleNavigate('price-history')}
                          className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors border border-slate-100 dark:border-slate-700/80"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 line-clamp-1">
                              {alert.productName}
                            </span>
                            <TrendingDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 ml-1" />
                          </div>
                          <div className="flex items-center justify-between mt-1 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                            <span>Țintă: {alert.targetPrice.toFixed(2)} lei</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">
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

            <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

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
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                  aria-label="Meniu profil utilizator"
                  aria-expanded={showProfileMenu}
                >
                  <div className="w-5 h-5 rounded-full bg-slate-800 dark:bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center overflow-hidden shrink-0">
                    {avatarSrc ? (
                      <img src={avatarSrc} alt={userProfile.name} className="w-full h-full object-cover" />
                    ) : (
                      <span>{userProfile.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="text-xs font-semibold max-w-[80px] sm:max-w-[110px] truncate text-slate-800 dark:text-slate-100">
                    {userProfile.name.split(' ')[0]}
                  </span>
                  {isUserAdmin && (
                    <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-1 py-0.2 rounded hidden sm:inline">
                      Admin
                    </span>
                  )}
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} />
                </button>

                {showProfileMenu && (
                  <div
                    role="menu"
                    aria-label="Meniu cont utilizator"
                    className="absolute right-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-2 z-50 animate-in fade-in zoom-in-95"
                  >
                    {/* Antet Utilizator */}
                    <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{userProfile.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{userProfile.email || 'Utilizator conectat'}</div>
                      </div>
                      {isUserAdmin && (
                        <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.5 rounded">
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
                          currentTab === 'profile' ? 'text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Profilul meu & Setări</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate('shopping-list')}
                        className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center justify-between text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <ShoppingBag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          <span>Lista de cumpărături</span>
                        </span>
                        {itemsCount > 0 && (
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-1.5 rounded-full">
                            {itemsCount}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate('price-history')}
                        className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Alerte de preț</span>
                      </button>
                    </div>

                    {/* MUTAREA SECȚIUNII ADMIN */}
                    {isUserAdmin && (
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-1 pb-1 mt-1 bg-slate-50/60 dark:bg-slate-800/50 rounded-xl px-1">
                        <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Administrare
                        </div>
                        <button
                          type="button"
                          onClick={() => handleNavigate('admin-sources')}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 font-medium transition-colors cursor-pointer ${
                            currentTab === 'admin-sources'
                              ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-950/70 font-bold'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Panou Admin Cataloage</span>
                        </button>
                      </div>
                    )}

                    {/* Ieșire din cont */}
                    {onSignOut && (
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowProfileMenu(false);
                            void onSignOut();
                          }}
                          className="w-full text-left px-3 py-2 text-xs rounded-xl flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors font-medium cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
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
                  className="px-2 sm:px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
        {/* Brand Logo & Wordmark (single clean line) */}
        <button
          type="button"
          onClick={() => handleNavigate('dashboard')}
          aria-label="Mergi la pagina principală Coșul Meu"
          className="flex items-center gap-2.5 cursor-pointer group shrink-0 text-left focus-visible:outline-emerald-600 whitespace-nowrap"
        >
          <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-emerald-600 group-hover:bg-emerald-700 flex items-center justify-center text-white transition-colors">
            <ShoppingBasket className="w-4.5 h-4.5" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Coșul<span className="text-emerald-600 dark:text-emerald-400">Meu</span>
          </span>
        </button>

        {/* DESKTOP MAIN NAV */}
        <nav aria-label="Navigație principală" className="hidden lg:flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            onMouseEnter={() => prefetch('dashboard')}
            onFocus={() => prefetch('dashboard')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'dashboard'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            Acasă
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('products')}
            onMouseEnter={() => prefetch('products')}
            onFocus={() => prefetch('products')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'products' || currentTab === 'product-detail'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            Produse
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('shopping-list')}
            onMouseEnter={() => prefetch('shopping-list')}
            onFocus={() => prefetch('shopping-list')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'shopping-list'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            <span>Lista mea</span>
            {itemsCount > 0 && (
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                ({itemsCount})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            onMouseEnter={() => prefetch('compare')}
            onFocus={() => prefetch('compare')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'compare'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            Compară prețuri
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('receipts')}
            onMouseEnter={() => prefetch('receipts')}
            onFocus={() => prefetch('receipts')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'receipts' || currentTab === 'scan-receipt'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            Bonuri
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('stores')}
            onMouseEnter={() => prefetch('stores')}
            onFocus={() => prefetch('stores')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentTab === 'stores'
                ? 'bg-emerald-50/90 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800'
            }`}
          >
            Magazine
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
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Acasă
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('products')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              currentTab === 'products' || currentTab === 'product-detail'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Produse
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('shopping-list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap ${
              currentTab === 'shopping-list'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Lista</span>
            {itemsCount > 0 && (
              <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {itemsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('compare')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              currentTab === 'compare'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
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
                  ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>Mai multe</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 animate-in fade-in zoom-in-95">
                <button
                  type="button"
                  onClick={() => handleNavigate('receipts')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                    currentTab === 'receipts' || currentTab === 'scan-receipt'
                      ? 'text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <ReceiptText className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Bonuri fiscale</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('stores')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                    currentTab === 'stores' ? 'text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60' : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <StoreIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Magazine partenere</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('price-history')}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                    currentTab === 'price-history' ? 'text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60' : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <LineChart className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
            className="md:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
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
          <aside className="fixed inset-y-0 right-0 max-w-xs w-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col z-[1000] h-screen max-h-[100dvh] animate-in slide-in-from-right duration-200">
            {/* Drawer Header (Fix sus) */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs">
                  <ShoppingBasket className="w-4 h-4" />
                </div>
                <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-slate-100">
                  Coșul<span className="text-emerald-600 dark:text-emerald-400">Meu</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Închide meniul"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body: Scrollabil cu tot conținutul și toate secțiunile */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* User Account / Auth Card */}
              {isAuthenticated ? (
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-slate-800 dark:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center overflow-hidden shrink-0">
                      {avatarSrc ? (
                        <img src={avatarSrc} alt={userProfile.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{userProfile.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{userProfile.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{userProfile.email}</div>
                    </div>
                  </div>
                  {isUserAdmin && (
                    <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.5 rounded shrink-0">
                      Admin
                    </span>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 flex flex-col gap-2.5">
                  <span className="text-xs text-slate-700 dark:text-slate-200 font-semibold">Contul tău Coșul Meu</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleNavigate('auth')}
                      className="flex-1 py-2 text-center text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-2xs transition-colors cursor-pointer"
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

              {/* Theme Switcher în Mobile Drawer */}
              {onChangeTheme && (
                <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Aspect aplicație
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'light' as ThemeMode, label: 'Luminos', Icon: Sun },
                      { id: 'dark' as ThemeMode, label: 'Întunecat', Icon: Moon },
                      { id: 'system' as ThemeMode, label: 'Automat', Icon: Monitor }
                    ].map(({ id, label, Icon }) => {
                      const active = themeMode === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onChangeTheme(id)}
                          className={`py-2 px-2 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Oraș selectat în Drawer cu picker inline */}
              <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Oraș selectat pentru oferte
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerCityPickerOpen(!drawerCityPickerOpen)}
                  className="w-full flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shadow-2xs"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    {userProfile.city}
                  </span>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                    Schimbă <ChevronDown className={`w-3 h-3 transition-transform ${drawerCityPickerOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {/* Inline City List if expanded */}
                {drawerCityPickerOpen && (
                  <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 shadow-inner">
                    {ROMANIAN_CITIES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          onUpdateProfile({ ...userProfile, city: c });
                          setDrawerCityPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                          userProfile.city === c ? 'text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{c}</span>
                        {userProfile.city === c && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
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
                      currentTab === 'dashboard' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ShoppingBasket className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Acasă</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('products')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'products' || currentTab === 'product-detail'
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span>Produse & Categorii</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('shopping-list')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                      currentTab === 'shopping-list' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <ShoppingBag className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Lista mea de cumpărături</span>
                    </span>
                    {itemsCount > 0 && (
                      <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {itemsCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('compare')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'compare' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Compară prețuri supermarket</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('receipts')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'receipts' || currentTab === 'scan-receipt'
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ReceiptText className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span>Bonuri fiscale & Scanare</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('stores')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'stores' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <StoreIcon className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span>Magazine partenere</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('price-history')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                      currentTab === 'price-history' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <LineChart className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Evoluție prețuri & Alerte</span>
                    </span>
                    {activeAlerts.length > 0 && (
                      <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {activeAlerts.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigate('profile')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'profile' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <User className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span>Profilul meu & Setări</span>
                  </button>
                </nav>
              </div>

              {/* MUTAREA SECȚIUNII ADMIN ÎN DRAWER */}
              {isUserAdmin && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span>Administrare sistem</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleNavigate('admin-sources')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                      currentTab === 'admin-sources'
                        ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 font-bold'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Panou Admin Cataloage</span>
                  </button>
                </div>
              )}
            </div>

            {/* Drawer Footer (Fix jos) */}
            {isAuthenticated && onSignOut && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 shrink-0 bg-slate-50 dark:bg-slate-900/95">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    void onSignOut();
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-red-500 dark:text-red-400" />
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
