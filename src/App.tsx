import React, { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDashboardData } from './services/useDashboardData.js';
import {
  countLocalDashboardData,
  deleteReceiptForUser,
  importLocalDashboardData,
  savePriceAlertsForUser,
  saveReceiptForUser,
  saveShoppingListsForUser,
  saveTrackedProductsForUser,
  type DashboardImportResult,
  type LocalDashboardSnapshot
} from './services/DashboardDataService.js';
import { Navbar } from './components/Navbar.js';
import { MobileNav } from './components/MobileNav.js';
import { DashboardView } from './components/DashboardView.js';
import { Footer } from './components/Footer.js';
import { CookieConsentBanner } from './components/CookieConsentBanner.js';
import { CookiePreferencesModal } from './components/CookiePreferencesModal.js';
import {
  acceptAllCookies,
  getEffectiveCookieCategories,
  getStoredCookieConsent,
  hasCategoryConsent,
  rejectOptionalCookies,
  saveCookieConsentChoice,
  scriptConsentController,
  shouldShowCookieBanner,
  withdrawOptionalCookieConsent
} from './services/CookieConsentService.js';
import {
  LEGAL_ROUTE_MAP,
  resolveLegalRouteFromPath,
  type LegalRoutePath
} from './config/legalConfig.js';

const loadProductsView = () => import('./components/ProductsView.js');
const loadProductDetailView = () => import('./components/ProductDetailView.js');
const loadShoppingListView = () => import('./components/ShoppingListView.js');
const loadPriceComparisonView = () => import('./components/PriceComparisonView.js');
const loadReceiptScanView = () => import('./components/ReceiptScanView.js');
const loadReceiptHistoryView = () => import('./components/ReceiptHistoryView.js');
const loadPriceHistoryView = () => import('./components/PriceHistoryView.js');
const loadStoresView = () => import('./components/StoresView.js');
const loadProfileView = () => import('./components/ProfileView.js');
const loadAdminSourcesView = () => import('./components/AdminSourcesView.js');
const loadAuthScreen = () => import('./components/AuthScreen.js');
const loadLegalPagesView = () => import('./components/LegalPagesView.js');

const ProductsView = lazy(() => loadProductsView().then(m => ({ default: m.ProductsView })));
const ProductDetailView = lazy(() => loadProductDetailView().then(m => ({ default: m.ProductDetailView })));
const ShoppingListView = lazy(() => loadShoppingListView().then(m => ({ default: m.ShoppingListView })));
const PriceComparisonView = lazy(() => loadPriceComparisonView().then(m => ({ default: m.PriceComparisonView })));
const ReceiptScanView = lazy(() => loadReceiptScanView().then(m => ({ default: m.ReceiptScanView })));
const ReceiptHistoryView = lazy(() => loadReceiptHistoryView().then(m => ({ default: m.ReceiptHistoryView })));
const PriceHistoryView = lazy(() => loadPriceHistoryView().then(m => ({ default: m.PriceHistoryView })));
const StoresView = lazy(() => loadStoresView().then(m => ({ default: m.StoresView })));
const ProfileView = lazy(() => loadProfileView().then(m => ({ default: m.ProfileView })));
const AdminSourcesView = lazy(() => loadAdminSourcesView().then(m => ({ default: m.AdminSourcesView })));
const AuthScreen = lazy(() => loadAuthScreen().then(m => ({ default: m.AuthScreen })));
const LegalPagesView = lazy(() => loadLegalPagesView().then(m => ({ default: m.LegalPagesView })));

const TAB_PREFETCHERS: Record<string, () => Promise<unknown>> = {
  products: loadProductsView,
  'product-detail': loadProductDetailView,
  'shopping-list': loadShoppingListView,
  compare: loadPriceComparisonView,
  'scan-receipt': loadReceiptScanView,
  receipts: loadReceiptHistoryView,
  'price-history': loadPriceHistoryView,
  stores: loadStoresView,
  profile: loadProfileView,
  'admin-sources': loadAdminSourcesView,
  auth: loadAuthScreen
};

const TabContentSkeleton: React.FC = () => (
  <div className="space-y-6 pb-16 animate-pulse" aria-busy="true" aria-label="Se încarcă secțiunea">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-2.5">
        <div className="h-3.5 w-44 rounded bg-slate-200/80 dark:bg-slate-800" />
        <div className="h-8 w-72 rounded-lg bg-slate-200/90 dark:bg-slate-800" />
        <div className="h-4 w-96 max-w-full rounded bg-slate-200/70 dark:bg-slate-800/80" />
      </div>
      <div className="h-10 w-44 rounded-xl bg-slate-200/80 dark:bg-slate-800" />
    </div>
    <div className="h-36 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-6" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="h-52 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800" />
      <div className="h-52 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800" />
      <div className="h-52 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hidden md:block" />
    </div>
  </div>
);

import { StorageService } from './services/StorageService.js';
import {
  applyThemeToDocument,
  getStoredThemeMode,
  getSystemPrefersDark,
  loadUserThemePreference,
  normalizeThemeMode,
  resolveIsDark,
  saveUserThemePreference
} from './services/ThemeService.js';
import { ShoppingList, Receipt, UserProfile, PriceAlert, Product, ProductOffer, Store, ThemeMode } from './types.js';
import { useAuth } from './auth/AuthProvider.js';
import { supabase } from './lib/supabase.js';
import { PRODUCTS } from './data/mockData.js';
import {
  buildGuestDemoShoppingList,
  GUEST_DEMO_LIST_ID,
  materializeGuestDemoLists,
  selectDashboardListsForSession
} from './utils/guestDemoBasket.js';

const normalizeStoreKey = (value: string): string =>
  (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();

const canonicalizeStores = (rawStores: Store[]): Store[] => {
  const byKey = new Map<string, Store>();
  for (const store of rawStores) {
    if (!store?.id || store.id === 'validation-only-retailer' || store.slug === 'validation-only-retailer') {
      continue;
    }
    const key = normalizeStoreKey(store.slug || store.id);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || (existing.id !== key && store.id === key)) {
      byKey.set(key, store);
    }
  }
  return Array.from(byKey.values());
};

export default function App() {
  const { user, session, loading, signOut } = useAuth();
  const {
    data: dashboardData,
    error: dashboardLoadError,
    isLoading: dashboardLoading,
    mutate: mutateDashboardData
  } = useDashboardData(user?.id);
  const [isImportingLocalData, setIsImportingLocalData] = useState(false);
  const [dashboardImportError, setDashboardImportError] = useState<string | null>(null);
  const [dashboardImportResult, setDashboardImportResult] = useState<DashboardImportResult | null>(null);
  const [dataWriteError, setDataWriteError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [activeLegalRoute, setActiveLegalRoute] = useState<LegalRoutePath | null>(() =>
    typeof window !== 'undefined' ? resolveLegalRouteFromPath(window.location.pathname) : null
  );
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productFilterCategory, setProductFilterCategory] = useState<string>('toate');

  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>(() =>
    StorageService.getShoppingLists()
  );
  const [activeListId, setActiveListId] = useState<string>(() =>
    StorageService.getActiveListId()
  );
  const [receipts, setReceipts] = useState<Receipt[]>(() =>
    StorageService.getReceipts()
  );
  const [userProfile, setUserProfile] = useState<UserProfile>(() =>
    StorageService.getUserProfile()
  );
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() =>
    StorageService.getPriceAlerts()
  );
  const [trackedProductIds, setTrackedProductIds] = useState<string[]>(() =>
    StorageService.getTrackedProducts()
  );
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [catalogOffers, setCatalogOffers] = useState<ProductOffer[]>([]);
  const [catalogStores, setCatalogStores] = useState<Store[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());
  const isDarkMode = resolveIsDark(themeMode, systemPrefersDark);
  const catalogLoadedRef = useRef(false);

  // Cookie Consent state (persisted across refresh, navigation & auth)
  const [cookieConsentState, setCookieConsentState] = useState(() => getStoredCookieConsent());
  const [showCookieBanner, setShowCookieBanner] = useState(() => shouldShowCookieBanner());
  const [showCookieModal, setShowCookieModal] = useState(false);

  useEffect(() => {
    const stored = getStoredCookieConsent();
    setCookieConsentState(stored);
    setShowCookieBanner(shouldShowCookieBanner(stored));
    scriptConsentController.evaluateAndLoadScripts(stored);
    return scriptConsentController.subscribe(next => {
      setCookieConsentState(next);
      setShowCookieBanner(shouldShowCookieBanner(next));
    });
  }, [currentTab, activeLegalRoute, user?.id]);

  useEffect(() => {
    const canPersistTheme = hasCategoryConsent('preferences', cookieConsentState);
    applyThemeToDocument(themeMode, systemPrefersDark, canPersistTheme);
  }, [themeMode, systemPrefersDark, cookieConsentState]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const loadCatalogDatasets = useCallback(() => {
    if (catalogLoadedRef.current) return;
    catalogLoadedRef.current = true;
    Promise.all([
      fetch('/api/catalog/products').then(r => r.json()).catch(() => null),
      fetch('/api/catalog/offers').then(r => r.json()).catch(() => null),
      fetch('/api/stores').then(r => r.json()).catch(() => null)
    ]).then(([prodRes, offRes, storeRes]) => {
      if (prodRes?.success && Array.isArray(prodRes.products)) setCatalogProducts(prodRes.products);
      if (offRes?.success && Array.isArray(offRes.offers)) setCatalogOffers(offRes.offers);
      if (storeRes?.success && Array.isArray(storeRes.stores)) setCatalogStores(canonicalizeStores(storeRes.stores));
    });
  }, []);

  // Load catalog immediately when needed by dashboard/catalog/list/compare/stores, otherwise prefetch lazily after first paint
  useEffect(() => {
    if (['dashboard', 'shopping-list', 'compare', 'products', 'stores', 'product-detail'].includes(currentTab)) {
      loadCatalogDatasets();
      return;
    }
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(() => loadCatalogDatasets(), { timeout: 1500 });
      return () => win.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => loadCatalogDatasets(), 900);
    return () => window.clearTimeout(timer);
  }, [currentTab, loadCatalogDatasets]);

  const handlePrefetchTab = useCallback((tab: string) => {
    const loader = TAB_PREFETCHERS[tab];
    if (loader) void loader();
    if (['shopping-list', 'compare', 'products', 'stores'].includes(tab)) {
      loadCatalogDatasets();
    }
  }, [loadCatalogDatasets]);
  const localDashboardSnapshot: LocalDashboardSnapshot = {
    receipts,
    shoppingLists,
    priceAlerts,
    trackedProductIds
  };
  const localImportCounts = countLocalDashboardData(localDashboardSnapshot);

  const isAdmin = Boolean(
    userProfile.role === 'admin' ||
    user?.user_metadata?.is_admin === true ||
    user?.email === 'pascalau.stefan@gmail.com'
  );

  useEffect(() => {
    if (!user) {
      setUserProfile({ ...StorageService.getUserProfile(), theme: getStoredThemeMode() });
      return;
    }
    let cancelled = false;
    const userId = user.id;
    const userEmail = user.email;

    Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, display_name, username, avatar_url, phone, phone_number, city, preferred_store_id, preferred_language, role, restriction_requested, restriction_reason, restriction_updated_at, preferences, created_at')
        .eq('id', userId)
        .maybeSingle(),
      loadUserThemePreference(userId),
      supabase
        .from('user_preferences')
        .select('optional_notifications_enabled, marketing_consent, marketing_consent_updated_at, marketing_consent_withdrawn_at')
        .eq('user_id', userId)
        .maybeSingle()
    ]).then(async ([profileRes, remoteTheme, gdprPrefRes]) => {
      if (cancelled) return;
      const data = profileRes.data;
      const gdprPrefs = gdprPrefRes?.data as any;
      const currentTheme = getStoredThemeMode();
      const resolvedTheme = remoteTheme ?? currentTheme;

      if (remoteTheme) {
        setThemeMode(remoteTheme);
        applyThemeToDocument(
          remoteTheme,
          getSystemPrefersDark(),
          hasCategoryConsent('preferences', getStoredCookieConsent())
        );
      } else {
        void saveUserThemePreference(userId, currentTheme, {
          language: data?.preferred_language || 'ro'
        });
      }

      if (data) {
        const preferences = (data.preferences || {}) as Record<string, unknown>;
        const loadedProfile: UserProfile = {
          id: data.id,
          name: data.display_name || [data.first_name, data.last_name].filter(Boolean).join(' ') || user.user_metadata?.display_name || (userEmail ? userEmail.split('@')[0] : 'Utilizator'),
          firstName: data.first_name || undefined,
          lastName: data.last_name || undefined,
          email: userEmail || '',
          username: data.username || user.user_metadata?.username || undefined,
          avatarUrl: data.avatar_url || undefined,
          avatar_url: data.avatar_url || undefined,
          phone: data.phone_number || data.phone || undefined,
          phoneNumber: data.phone_number || data.phone || undefined,
          city: data.city || 'București',
          preferredLanguage: data.preferred_language || 'ro',
          theme: resolvedTheme,
          preferredStoreId: data.preferred_store_id || undefined,
          role: (data.role as 'user' | 'admin') || (userEmail === 'pascalau.stefan@gmail.com' ? 'admin' : 'user'),
          monthlySavingsGoal: typeof preferences.monthlySavingsGoal === 'number' ? preferences.monthlySavingsGoal : 350,
          notificationsEnabled: typeof preferences.notificationsEnabled === 'boolean' ? preferences.notificationsEnabled : false,
          optionalNotificationsEnabled: Boolean(gdprPrefs?.optional_notifications_enabled),
          marketingConsent: Boolean(gdprPrefs?.marketing_consent),
          marketingConsentUpdatedAt: gdprPrefs?.marketing_consent_updated_at || undefined,
          marketingConsentWithdrawnAt: gdprPrefs?.marketing_consent_withdrawn_at || undefined,
          restrictionRequested: Boolean((data as any).restriction_requested),
          restrictionReason: (data as any).restriction_reason || undefined,
          restrictionUpdatedAt: (data as any).restriction_updated_at || undefined,
          preferredStores: Array.isArray(preferences.preferredStores) ? preferences.preferredStores : ['lidl', 'kaufland', 'carrefour', 'auchan'],
          defaultTransportCostEstimate: typeof preferences.defaultTransportCostEstimate === 'number' ? preferences.defaultTransportCostEstimate : 12,
          useLoyaltyCards: typeof preferences.useLoyaltyCards === 'boolean' ? preferences.useLoyaltyCards : true,
          createdAt: data.created_at || user.created_at,
          created_at: data.created_at || user.created_at,
        };
        setUserProfile(loadedProfile);
        StorageService.saveUserProfile(loadedProfile);
      } else {
        const defaultName = user.user_metadata?.display_name || (userEmail ? userEmail.split('@')[0] : 'Utilizator');
        const defaultUsername = user.user_metadata?.username || undefined;
        const defaultRole: 'user' | 'admin' = (userEmail === 'pascalau.stefan@gmail.com' || user.user_metadata?.is_admin) ? 'admin' : 'user';

        const newProfileRow = {
          id: userId,
          display_name: defaultName,
          username: defaultUsername,
          city: 'București',
          role: defaultRole,
          preferred_language: 'ro',
          preferences: {
            monthlySavingsGoal: 350,
            notificationsEnabled: false,
            preferredStores: ['lidl', 'kaufland', 'carrefour', 'auchan'],
            defaultTransportCostEstimate: 12,
            useLoyaltyCards: true
          }
        };

        const { error: profileCreateError } = await supabase.from('profiles').insert(newProfileRow);
        if (profileCreateError && profileCreateError.code !== '23505') {
          setDataWriteError('Profilul nu a putut fi inițializat în Supabase.');
        }

        const initialProfile: UserProfile = {
          id: userId,
          name: defaultName,
          email: userEmail || '',
          username: defaultUsername,
          city: 'București',
          role: defaultRole,
          preferredLanguage: 'ro',
          theme: resolvedTheme,
          monthlySavingsGoal: 350,
          notificationsEnabled: false,
          preferredStores: ['lidl', 'kaufland', 'carrefour', 'auchan'],
          defaultTransportCostEstimate: 12,
          useLoyaltyCards: true,
          createdAt: user.created_at,
          created_at: user.created_at,
        };
        setUserProfile(initialProfile);
        StorageService.saveUserProfile(initialProfile);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleChangeTheme = useCallback(async (nextTheme: ThemeMode) => {
    const normalized = normalizeThemeMode(nextTheme);
    setThemeMode(normalized);
    applyThemeToDocument(
      normalized,
      getSystemPrefersDark(),
      hasCategoryConsent('preferences', getStoredCookieConsent())
    );
    setUserProfile(prev => {
      const updated = { ...prev, theme: normalized };
      StorageService.saveUserProfile(updated);
      return updated;
    });
    if (user) {
      await saveUserThemePreference(user.id, normalized, {
        notificationsEnabled: userProfile.notificationsEnabled,
        priceAlertsEnabled: userProfile.notificationsEnabled,
        language: userProfile.preferredLanguage || 'ro'
      });
    }
  }, [user, userProfile.notificationsEnabled, userProfile.preferredLanguage]);

  const handleProfileUpdate = (profile: UserProfile) => {
    const effectiveTheme = normalizeThemeMode(profile.theme ?? themeMode, themeMode);
    const updatedProfile = { ...profile, theme: effectiveTheme };
    setUserProfile(updatedProfile);
    StorageService.saveUserProfile(updatedProfile);

    if (profile.theme && profile.theme !== themeMode) {
      setThemeMode(effectiveTheme);
      applyThemeToDocument(
        effectiveTheme,
        getSystemPrefersDark(),
        hasCategoryConsent('preferences', getStoredCookieConsent())
      );
    }

    if (user) {
      void supabase.from('profiles').upsert({
        id: user.id,
        first_name: updatedProfile.firstName || null,
        last_name: updatedProfile.lastName || null,
        display_name: updatedProfile.name,
        username: updatedProfile.username || null,
        city: updatedProfile.city,
        phone: updatedProfile.phone || updatedProfile.phoneNumber || null,
        phone_number: updatedProfile.phoneNumber || updatedProfile.phone || null,
        preferred_language: updatedProfile.preferredLanguage || 'ro',
        preferred_store_id: updatedProfile.preferredStoreId || null,
        avatar_url: updatedProfile.avatarUrl || updatedProfile.avatar_url || null,
        preferences: {
          monthlySavingsGoal: updatedProfile.monthlySavingsGoal,
          notificationsEnabled: updatedProfile.notificationsEnabled,
          preferredStores: updatedProfile.preferredStores,
          defaultTransportCostEstimate: updatedProfile.defaultTransportCostEstimate,
          useLoyaltyCards: updatedProfile.useLoyaltyCards,
          ...(dashboardData ? {
            trackedProductIds: dashboardData.trackedProductIds,
            localHistoryImportedAt: dashboardData.localDataImportedAt
          } : {})
        },
        updated_at: new Date().toISOString(),
      });
      void saveUserThemePreference(user.id, effectiveTheme, {
        notificationsEnabled: updatedProfile.notificationsEnabled,
        priceAlertsEnabled: updatedProfile.notificationsEnabled,
        language: updatedProfile.preferredLanguage || 'ro'
      });
    }
  };

  const guestDemoList = useMemo(
    () =>
      buildGuestDemoShoppingList(
        catalogProducts.length > 0 ? catalogProducts : PRODUCTS,
        catalogOffers
      ),
    [catalogProducts, catalogOffers]
  );

  // Reset activeListId if the user logs in while viewing the virtual guest demo basket
  useEffect(() => {
    if (user && activeListId === GUEST_DEMO_LIST_ID) {
      const storedActive = StorageService.getActiveListId();
      setActiveListId(storedActive && storedActive !== GUEST_DEMO_LIST_ID ? storedActive : '');
    }
  }, [user, activeListId]);

  // Keep every hook before conditional loading/auth returns.
  useEffect(() => {
    const syncLocationState = () => {
      const legalRoute = resolveLegalRouteFromPath(window.location.pathname);
      if (legalRoute) {
        setActiveLegalRoute(legalRoute);
        return;
      }

      setActiveLegalRoute(null);
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const productParam = params.get('product');
      const categoryParam = params.get('category');

      if (categoryParam) setProductFilterCategory(categoryParam);

      if (productParam) {
        setSelectedProductId(productParam);
        setCurrentTab('product-detail');
      } else if (tabParam && ['dashboard', 'products', 'shopping-list', 'compare', 'scan-receipt', 'receipts', 'price-history', 'stores', 'admin-sources', 'profile', 'auth'].includes(tabParam)) {
        setSelectedProductId(null);
        if (tabParam === 'admin-sources' && !isAdmin) {
          setCurrentTab(user ? 'profile' : 'auth');
        } else {
          setCurrentTab(tabParam);
        }
      } else {
        setSelectedProductId(null);
        setCurrentTab('dashboard');
      }
    };

    syncLocationState();
    window.addEventListener('popstate', syncLocationState);
    return () => window.removeEventListener('popstate', syncLocationState);
  }, [user, isAdmin]);

  useEffect(() => {
    if (activeLegalRoute) {
      document.title = `${LEGAL_ROUTE_MAP[activeLegalRoute].title} - Coșul Meu`;
    } else {
      document.title = 'Coșul Meu - Comparator Prețuri & Bonuri';
    }
  }, [activeLegalRoute]);

  if (loading && !activeLegalRoute) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
        <header className="sticky top-0 z-40 h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-600/15 dark:bg-emerald-500/20 animate-pulse" />
              <div className="h-5 w-28 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
            </div>
            <div className="hidden md:flex items-center gap-6">
              <div className="h-4 w-16 rounded bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
              <div className="h-4 w-16 rounded bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
              <div className="h-4 w-20 rounded bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
              <div className="h-4 w-24 rounded bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
            </div>
            <div className="h-9 w-32 rounded-xl bg-emerald-600/20 dark:bg-emerald-500/20 animate-pulse" />
          </div>
        </header>
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          <TabContentSkeleton />
        </main>
      </div>
    );
  }

  const emptyList: ShoppingList = {
    id: 'list-fallback',
    name: 'Coșul Meu',
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const { lists: sessionLists, isDemoMode: isGuestDemoMode } = selectDashboardListsForSession({
    isAuthenticated: Boolean(user),
    userShoppingLists: dashboardData?.shoppingLists,
    localShoppingLists: shoppingLists,
    guestDemoList
  });
  const screenShoppingLists = sessionLists.length > 0 ? sessionLists : [emptyList];
  const activeList =
    screenShoppingLists.find(list => list.id === activeListId && !list.isArchived) ||
    screenShoppingLists.find(list => !list.isArchived) ||
    screenShoppingLists[0] ||
    emptyList;
  const dashboardReceipts = user ? dashboardData?.receipts || [] : receipts;
  const dashboardAlerts = user ? dashboardData?.priceAlerts || [] : priceAlerts;
  const dashboardTrackedProductIds = user ? dashboardData?.trackedProductIds || [] : trackedProductIds;
  const canImportLocalData = Boolean(
    user && dashboardData && !dashboardData.localDataImportedAt && localImportCounts.total > 0
  );

  const handleImportLocalData = async () => {
    if (!user || !dashboardData || !canImportLocalData || isImportingLocalData) return;
    setIsImportingLocalData(true);
    setDashboardImportError(null);
    setDashboardImportResult(null);
    try {
      const result = await importLocalDashboardData(user.id, localDashboardSnapshot);
      setDashboardImportResult(result);
      await mutateDashboardData();
    } catch (error) {
      setDashboardImportError(error instanceof Error ? error.message : 'Importul nu a putut fi finalizat.');
    } finally {
      setIsImportingLocalData(false);
    }
  };

  const handleUpdateShoppingLists = async (nextLists: ShoppingList[]): Promise<boolean> => {
    if (!user) {
      const replacementId = crypto.randomUUID();
      const hasVirtualDemo = nextLists.some(l => l.id === GUEST_DEMO_LIST_ID);
      const materialized = hasVirtualDemo
        ? materializeGuestDemoLists(nextLists, replacementId)
        : nextLists;
      setShoppingLists(materialized);
      StorageService.saveShoppingLists(materialized);
      if (
        materialized.length > 0 &&
        (!materialized.some(l => l.id === activeListId) || activeListId === GUEST_DEMO_LIST_ID)
      ) {
        const nextActiveId = hasVirtualDemo ? replacementId : materialized[0].id;
        setActiveListId(nextActiveId);
        StorageService.setActiveListId(nextActiveId);
      }
      return true;
    }
    if (!dashboardData) {
      setDataWriteError('Listele nu au putut fi salvate deoarece datele contului nu sunt încărcate.');
      return false;
    }
    try {
      const savedLists = await saveShoppingListsForUser(user.id, dashboardData.shoppingLists, nextLists);
      await mutateDashboardData(current => current ? { ...current, shoppingLists: savedLists } : current, { revalidate: false });
      void mutateDashboardData();
      setDataWriteError(null);
      const selectedList =
        savedLists.find(list => list.id === activeList.id) ||
        savedLists.find(list => list.name === activeList.name) ||
        savedLists[0];
      if (selectedList) {
        setActiveListId(selectedList.id);
        StorageService.setActiveListId(selectedList.id);
      }
      return true;
    } catch (error) {
      setDataWriteError(error instanceof Error ? error.message : 'Lista nu a putut fi sincronizată.');
      return false;
    }
  };

  const handleUpdateReceipts = async (nextReceipts: Receipt[]) => {
    if (!user) {
      setReceipts(nextReceipts);
      StorageService.saveReceipts(nextReceipts);
      return;
    }
    if (!dashboardData) {
      setDataWriteError('Bonurile nu au putut fi actualizate deoarece datele contului nu sunt încărcate.');
      return;
    }
    try {
      const nextIds = new Set(nextReceipts.map(receipt => receipt.id));
      const removed = dashboardData.receipts.filter(receipt => !nextIds.has(receipt.id));
      await Promise.all(
        removed.map(receipt => deleteReceiptForUser(user.id, receipt.id, receipt.imagePaths))
      );
      await mutateDashboardData(current => current ? { ...current, receipts: nextReceipts } : current, { revalidate: false });
      setDataWriteError(null);
    } catch (error) {
      setDataWriteError(error instanceof Error ? error.message : 'Bonul nu a putut fi șters.');
    }
  };

  const handleUpdatePriceAlerts = async (nextAlerts: PriceAlert[]) => {
    if (!user) {
      setPriceAlerts(nextAlerts);
      StorageService.savePriceAlerts(nextAlerts);
      return;
    }
    if (!dashboardData) {
      setDataWriteError('Alertele nu au putut fi salvate deoarece datele contului nu sunt încărcate.');
      return;
    }
    try {
      const savedAlerts = await savePriceAlertsForUser(user.id, dashboardData.priceAlerts, nextAlerts);
      await mutateDashboardData(current => current ? { ...current, priceAlerts: savedAlerts } : current, { revalidate: false });
      setDataWriteError(null);
    } catch (error) {
      setDataWriteError(error instanceof Error ? error.message : 'Alerta nu a putut fi sincronizată.');
    }
  };

  const handleUpdateTrackedProducts = async (nextProductIds: string[]) => {
    if (!user) {
      setTrackedProductIds(nextProductIds);
      StorageService.saveTrackedProducts(nextProductIds);
      return;
    }
    try {
      const savedIds = await saveTrackedProductsForUser(user.id, nextProductIds);
      await mutateDashboardData(current => current ? { ...current, trackedProductIds: savedIds } : current, { revalidate: false });
      setDataWriteError(null);
    } catch (error) {
      setDataWriteError(error instanceof Error ? error.message : 'Lista de produse urmărite nu a putut fi sincronizată.');
    }
  };

  const handleNavigateToLegalRoute = (path: LegalRoutePath) => {
    setActiveLegalRoute(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = path;
    url.search = '';
    url.hash = '';
    window.history.pushState({}, '', url.toString());
  };

  const handleNavigateHomeFromLegal = () => {
    setActiveLegalRoute(null);
    setSelectedProductId(null);
    setCurrentTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    window.history.pushState({}, '', url.toString());
  };

  const handleSelectTab = (tab: string) => {
    setActiveLegalRoute(null);
    if (tab === 'admin-sources' && !isAdmin) {
      const fallbackTab = user ? 'profile' : 'auth';
      setCurrentTab(fallbackTab);
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.set('tab', fallbackTab);
      url.searchParams.delete('product');
      url.searchParams.delete('category');
      window.history.pushState({}, '', url.toString());
      return;
    }
    setCurrentTab(tab);
    if (tab !== 'product-detail') {
      setSelectedProductId(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('tab', tab);
    if (tab !== 'products' && tab !== 'product-detail') {
      url.searchParams.delete('product');
      url.searchParams.delete('category');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleSelectProduct = (productId: string) => {
    setActiveLegalRoute(null);
    setSelectedProductId(productId);
    setCurrentTab('product-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('tab', 'products');
    url.searchParams.set('product', productId);
    window.history.pushState({}, '', url.toString());
  };

  const handleBackFromDetail = () => {
    setActiveLegalRoute(null);
    setSelectedProductId(null);
    setCurrentTab('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.delete('product');
    url.searchParams.set('tab', 'products');
    window.history.pushState({}, '', url.toString());
  };

  const handleNavigateToCategory = (cat: string) => {
    setActiveLegalRoute(null);
    setProductFilterCategory(cat);
    setSelectedProductId(null);
    setCurrentTab('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.delete('product');
    url.searchParams.set('tab', 'products');
    url.searchParams.set('category', cat);
    window.history.pushState({}, '', url.toString());
  };

  const handleAddProductToList = async (
    productId: string,
    productName: string,
    productData?: Product
  ): Promise<boolean> => {
    if (user && !dashboardData) {
      setDataWriteError('Așteaptă încărcarea datelor contului înainte de a modifica lista.');
      return false;
    }

    let resolvedProduct: Product | undefined =
      productData ||
      catalogProducts.find(item => item.id === productId) ||
      dashboardData?.products?.find(item => item.id === productId) ||
      StorageService.getAllProducts().find(item => item.id === productId);

    if (!resolvedProduct) {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(productId)}`);
        if (res.ok) {
          const resData = await res.json();
          if (resData?.success && resData.product) {
            resolvedProduct = resData.product as Product;
          }
        }
      } catch {
        // Ignore and use metadata fallback below
      }
    }

    if (!resolvedProduct) {
      resolvedProduct = {
        id: productId,
        name: productName,
        brand: '',
        category: 'Alte produse',
        defaultUnit: 'buc',
        packageWeightOrVolume: 1,
        packageUnit: 'buc',
        normalizedUnit: 'buc',
        baseReferencePrice: 10
      };
    } else if (!catalogProducts.some(item => item.id === resolvedProduct!.id)) {
      setCatalogProducts(prev => [resolvedProduct!, ...prev]);
    }

    const targetListId =
      activeList.id === 'list-fallback' || activeList.id === GUEST_DEMO_LIST_ID
        ? crypto.randomUUID()
        : activeList.id;
    const nowIso = new Date().toISOString();

    const updated = screenShoppingLists.map(list => {
      if (list.id !== activeList.id) return list;
      const existingIndex = list.items.findIndex(item => item.productId === resolvedProduct!.id);
      const nextItems =
        existingIndex >= 0
          ? list.items.map((item, idx) =>
              idx === existingIndex
                ? {
                    ...item,
                    quantity: item.quantity + 1,
                    barcode: item.barcode || resolvedProduct!.barcode,
                    referencePrice: item.referencePrice ?? resolvedProduct!.baseReferencePrice,
                    estimatedPrice: item.estimatedPrice ?? resolvedProduct!.baseReferencePrice
                  }
                : item
            )
          : [
              {
                id: crypto.randomUUID(),
                productId: resolvedProduct!.id,
                name: resolvedProduct!.name || productName,
                brand: resolvedProduct!.brand,
                category: resolvedProduct!.category || 'Alte produse',
                quantity: 1,
                unit: resolvedProduct!.defaultUnit || 'buc',
                checked: false,
                barcode: resolvedProduct!.barcode,
                referencePrice: resolvedProduct!.baseReferencePrice,
                estimatedPrice: resolvedProduct!.baseReferencePrice
              },
              ...list.items
            ];

      return {
        ...list,
        id: targetListId,
        name: list.id === GUEST_DEMO_LIST_ID ? 'Coșul Meu' : list.name,
        items: nextItems,
        updatedAt: nowIso
      };
    });

    if (targetListId !== activeList.id) {
      handleActiveListSelect(targetListId);
    }

    return handleUpdateShoppingLists(updated);
  };

  const handleActiveListSelect = (listId: string) => {
    setActiveListId(listId);
    if (listId !== GUEST_DEMO_LIST_ID) {
      StorageService.setActiveListId(listId);
    }
  };

  const handleReceiptSaved = async (savedReceipt: Receipt) => {
    if (!user) {
      // Salvare exclusiv locală în modul vizitator (fără publicare în coada publică de descoperire)
      StorageService.addReceipt(savedReceipt);
      setReceipts(StorageService.getReceipts());
      return;
    }
    if (!dashboardData) throw new Error('Datele contului nu sunt încărcate. Încearcă din nou.');

    const saved = await saveReceiptForUser(user.id, savedReceipt, dashboardData.stores);
    await mutateDashboardData(current => current
      ? { ...current, receipts: [saved, ...current.receipts.filter(receipt => receipt.id !== saved.id)] }
      : current,
      { revalidate: false }
    );
    setDataWriteError(null);
  };

  const handleResetAllData = () => {
    StorageService.resetAllData();
    setShoppingLists(StorageService.getShoppingLists());
    setActiveListId(StorageService.getActiveListId());
    setReceipts(StorageService.getReceipts());
    setUserProfile(StorageService.getUserProfile());
    setPriceAlerts(StorageService.getPriceAlerts());
    setTrackedProductIds(StorageService.getTrackedProducts());
    setCurrentTab('dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-emerald-100 dark:selection:bg-emerald-900/60 selection:text-emerald-950 dark:selection:text-emerald-100 transition-colors">
      {/* Top Navbar */}
      <Navbar
        currentTab={activeLegalRoute ? '' : currentTab}
        onSelectTab={handleSelectTab}
        onPrefetchTab={handlePrefetchTab}
        userProfile={userProfile}
        onUpdateProfile={handleProfileUpdate}
        onSignOut={signOut}
        isAuthenticated={Boolean(user)}
        isAdmin={isAdmin}
        alerts={dashboardAlerts}
        itemsCount={activeList.items.length}
        themeMode={themeMode}
        isDarkMode={isDarkMode}
        onChangeTheme={handleChangeTheme}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {dataWriteError && (
          <div role="alert" className="mb-5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-800 dark:text-rose-200">
            {dataWriteError}
          </div>
        )}

        <Suspense fallback={<TabContentSkeleton />}>
          {activeLegalRoute ? (
            <LegalPagesView
              route={activeLegalRoute}
              onNavigateHome={handleNavigateHomeFromLegal}
              onNavigateLegal={handleNavigateToLegalRoute}
              onOpenCookieSettings={() => setShowCookieModal(true)}
            />
          ) : (
            <>
              {currentTab === 'auth' && (
                <AuthScreen
                  onSuccess={() => handleSelectTab('dashboard')}
                  onCancel={() => handleSelectTab('dashboard')}
                />
              )}

              {currentTab === 'dashboard' && (
            <DashboardView
              userProfile={userProfile}
              activeList={activeList}
              receipts={dashboardReceipts}
              trackedCount={dashboardTrackedProductIds.length}
              activeAlertCount={dashboardAlerts.filter(alert => alert.isActive).length}
              dataSource={user ? 'supabase' : 'local'}
              isAuthenticated={Boolean(user)}
              isDemoMode={isGuestDemoMode}
              catalogProducts={catalogProducts}
              catalogOffers={catalogOffers}
              catalogStores={catalogStores}
              dashboardData={dashboardData}
              dashboardLoading={Boolean(user && dashboardLoading)}
              dashboardError={user && dashboardLoadError ? 'Datele Supabase nu au putut fi încărcate.' : null}
              localImportCounts={localImportCounts}
              canImportLocalData={canImportLocalData}
              isImportingLocalData={isImportingLocalData}
              importError={dashboardImportError}
              importResult={dashboardImportResult}
              onImportLocalData={handleImportLocalData}
              onNavigate={handleSelectTab}
              onOpenReceipt={() => handleSelectTab('receipts')}
            />
          )}

          {currentTab === 'products' && (
            <ProductsView
              onSelectProduct={handleSelectProduct}
              activeList={activeList}
              onAddToList={handleAddProductToList}
              initialCategory={productFilterCategory}
            />
          )}

          {currentTab === 'product-detail' && selectedProductId && (
            <ProductDetailView
              productId={selectedProductId}
              onBack={handleBackFromDetail}
              onNavigateToCategory={handleNavigateToCategory}
              activeList={activeList}
              onAddToList={handleAddProductToList}
            />
          )}

          {currentTab === 'shopping-list' && (
            <ShoppingListView
              lists={screenShoppingLists}
              activeList={activeList}
              onUpdateLists={handleUpdateShoppingLists}
              onSelectActiveList={handleActiveListSelect}
              onCompare={() => handleSelectTab('compare')}
              catalogProducts={catalogProducts}
            />
          )}

          {currentTab === 'compare' && (
            <PriceComparisonView
              activeList={activeList}
              onNavigateToList={() => handleSelectTab('shopping-list')}
              onViewProductDetail={handleSelectProduct}
              catalogProducts={catalogProducts}
              catalogOffers={catalogOffers}
              catalogStores={catalogStores}
            />
          )}

          {currentTab === 'scan-receipt' && (
            <ReceiptScanView
              onReceiptSaved={handleReceiptSaved}
              onNavigateToHistory={() => handleSelectTab('receipts')}
            />
          )}

          {currentTab === 'receipts' && (
            <ReceiptHistoryView
              receipts={dashboardReceipts}
              onUpdateReceipts={handleUpdateReceipts}
              onNavigateToScan={() => handleSelectTab('scan-receipt')}
            />
          )}

          {currentTab === 'price-history' && (
            <PriceHistoryView
              alerts={dashboardAlerts}
              trackedProductIds={dashboardTrackedProductIds}
              onUpdateAlerts={handleUpdatePriceAlerts}
              onUpdateTrackedProductIds={handleUpdateTrackedProducts}
            />
          )}

          {currentTab === 'stores' && (
            <StoresView userCity={userProfile.city} />
          )}

          {currentTab === 'admin-sources' && (
            <AdminSourcesView />
          )}

              {currentTab === 'profile' && (
                <ProfileView
                  userProfile={userProfile}
                  onUpdateProfile={handleProfileUpdate}
                  onResetAllData={handleResetAllData}
                  onSignOut={signOut}
                  onNavigateToAuth={() => handleSelectTab('auth')}
                  themeMode={themeMode}
                  onChangeTheme={handleChangeTheme}
                  onOpenCookieSettings={() => setShowCookieModal(true)}
                  onNavigateLegal={handleNavigateToLegalRoute}
                />
              )}
            </>
          )}
        </Suspense>
      </main>

      {/* Footer */}
      <Footer
        activeLegalRoute={activeLegalRoute}
        onNavigateLegal={handleNavigateToLegalRoute}
        onNavigateHome={handleNavigateHomeFromLegal}
        onOpenCookieSettings={() => setShowCookieModal(true)}
        isAuthenticated={Boolean(user)}
      />

      {/* Cookie Consent Banner & Preferences Modal */}
      <CookieConsentBanner
        visible={showCookieBanner && !showCookieModal}
        onAcceptAll={() => {
          const next = acceptAllCookies(session?.access_token);
          setCookieConsentState(next);
          setShowCookieBanner(false);
        }}
        onRejectOptional={() => {
          const next = rejectOptionalCookies(session?.access_token);
          setCookieConsentState(next);
          setShowCookieBanner(false);
        }}
        onCustomize={() => setShowCookieModal(true)}
        onNavigateLegal={handleNavigateToLegalRoute}
      />

      <CookiePreferencesModal
        open={showCookieModal}
        initialCategories={getEffectiveCookieCategories()}
        lastUpdatedAt={cookieConsentState?.updatedAt}
        onClose={() => setShowCookieModal(false)}
        onSavePreferences={categories => {
          const next = saveCookieConsentChoice({
            categories,
            consentMethod: 'custom_preferences',
            accessToken: session?.access_token
          });
          setCookieConsentState(next);
          setShowCookieBanner(false);
          setShowCookieModal(false);
        }}
        onAcceptAll={() => {
          const next = acceptAllCookies(session?.access_token);
          setCookieConsentState(next);
          setShowCookieBanner(false);
          setShowCookieModal(false);
        }}
        onRejectOptional={() => {
          const next = rejectOptionalCookies(session?.access_token);
          setCookieConsentState(next);
          setShowCookieBanner(false);
          setShowCookieModal(false);
        }}
        onWithdrawOptional={() => {
          const next = withdrawOptionalCookieConsent(session?.access_token);
          setCookieConsentState(next);
          setShowCookieBanner(false);
          setShowCookieModal(false);
        }}
        onNavigateLegal={handleNavigateToLegalRoute}
      />

      {/* Mobile Bottom Navigation Bar */}
      <MobileNav
        currentTab={activeLegalRoute ? '' : currentTab}
        onSelectTab={handleSelectTab}
        onPrefetchTab={handlePrefetchTab}
        itemsCount={activeList.items.length}
      />
    </div>
  );
}
