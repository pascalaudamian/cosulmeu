import React, { useState, useEffect } from 'react';
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
import { ShoppingListView } from './components/ShoppingListView.js';
import { PriceComparisonView } from './components/PriceComparisonView.js';
import { ReceiptScanView } from './components/ReceiptScanView.js';
import { ReceiptHistoryView } from './components/ReceiptHistoryView.js';
import { PriceHistoryView } from './components/PriceHistoryView.js';
import { StoresView } from './components/StoresView.js';
import { ProfileView } from './components/ProfileView.js';
import { AdminSourcesView } from './components/AdminSourcesView.js';
import { ProductsView } from './components/ProductsView.js';
import { ProductDetailView } from './components/ProductDetailView.js';

import { StorageService } from './services/StorageService.js';
import { ShoppingList, Receipt, UserProfile, PriceAlert, Product, ProductOffer, Store } from './types.js';
import { ShieldCheck, Heart } from 'lucide-react';
import { useAuth } from './auth/AuthProvider.js';
import { AuthScreen } from './components/AuthScreen.js';
import { supabase } from './lib/supabase.js';

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
  const { user, loading, signOut } = useAuth();
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/catalog/products').then(r => r.json()).catch(() => null),
      fetch('/api/catalog/offers').then(r => r.json()).catch(() => null),
      fetch('/api/stores').then(r => r.json()).catch(() => null)
    ]).then(([prodRes, offRes, storeRes]) => {
      if (cancelled) return;
      if (prodRes?.success && Array.isArray(prodRes.products)) setCatalogProducts(prodRes.products);
      if (offRes?.success && Array.isArray(offRes.offers)) setCatalogOffers(offRes.offers);
      if (storeRes?.success && Array.isArray(storeRes.stores)) setCatalogStores(canonicalizeStores(storeRes.stores));
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
      setUserProfile(StorageService.getUserProfile());
      return;
    }
    const userId = user.id;
    const userEmail = user.email;

    supabase
      .from('profiles')
      .select('id, first_name, last_name, display_name, username, avatar_url, phone, phone_number, city, preferred_store_id, preferred_language, role, preferences, created_at')
      .eq('id', userId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          const preferences = (data.preferences || {}) as Record<string, unknown>;
          const loadedProfile: UserProfile = {
            id: data.id,
            name: data.display_name || [data.first_name, data.last_name].filter(Boolean).join(' ') || user.user_metadata?.display_name || (userEmail ? userEmail.split('@')[0] : 'Utilizator'),
            email: userEmail || '',
            username: data.username || user.user_metadata?.username || undefined,
            avatarUrl: data.avatar_url || undefined,
            avatar_url: data.avatar_url || undefined,
            phone: data.phone_number || data.phone || undefined,
            phoneNumber: data.phone_number || data.phone || undefined,
            city: data.city || 'București',
            preferredLanguage: data.preferred_language || 'ro',
            preferredStoreId: data.preferred_store_id || undefined,
            role: (data.role as 'user' | 'admin') || (userEmail === 'pascalau.stefan@gmail.com' ? 'admin' : 'user'),
            monthlySavingsGoal: typeof preferences.monthlySavingsGoal === 'number' ? preferences.monthlySavingsGoal : 350,
            notificationsEnabled: typeof preferences.notificationsEnabled === 'boolean' ? preferences.notificationsEnabled : true,
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
              notificationsEnabled: true,
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
            monthlySavingsGoal: 350,
            notificationsEnabled: true,
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
  }, [user]);

  const handleProfileUpdate = (profile: UserProfile) => {
    setUserProfile(profile);
    StorageService.saveUserProfile(profile);

    if (user) {
      void supabase.from('profiles').upsert({
        id: user.id,
        display_name: profile.name,
        username: profile.username || null,
        city: profile.city,
        phone_number: profile.phoneNumber || profile.phone || null,
        preferred_language: profile.preferredLanguage || 'ro',
        preferred_store_id: profile.preferredStoreId || null,
        avatar_url: profile.avatarUrl || profile.avatar_url || null,
        preferences: {
          monthlySavingsGoal: profile.monthlySavingsGoal,
          notificationsEnabled: profile.notificationsEnabled,
          preferredStores: profile.preferredStores,
          defaultTransportCostEstimate: profile.defaultTransportCostEstimate,
          useLoyaltyCards: profile.useLoyaltyCards,
          ...(dashboardData ? {
            trackedProductIds: dashboardData.trackedProductIds,
            localHistoryImportedAt: dashboardData.localDataImportedAt
          } : {})
        },
        updated_at: new Date().toISOString(),
      });
      void supabase.from('user_preferences').upsert({
        user_id: user.id,
        notifications_enabled: profile.notificationsEnabled,
        price_alerts_enabled: profile.notificationsEnabled,
        updated_at: new Date().toISOString(),
      });
    }
  };

  // Keep every hook before conditional loading/auth returns.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const productParam = params.get('product');
    const categoryParam = params.get('category');

    if (categoryParam) setProductFilterCategory(categoryParam);

    if (productParam) {
      setSelectedProductId(productParam);
      setCurrentTab('product-detail');
    } else if (tabParam && ['dashboard', 'products', 'shopping-list', 'compare', 'scan-receipt', 'receipts', 'price-history', 'stores', 'admin-sources', 'profile', 'auth'].includes(tabParam)) {
      if (tabParam === 'admin-sources' && !isAdmin) {
        setCurrentTab(user ? 'profile' : 'auth');
      } else {
        setCurrentTab(tabParam);
      }
    }
  }, [user, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 text-sm font-bold text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <span>Se verifică sesiunea securizată…</span>
        </div>
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
  const dashboardLists = user ? dashboardData?.shoppingLists || [] : shoppingLists;
  const screenShoppingLists = dashboardLists.length > 0 ? dashboardLists : [emptyList];
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
      setShoppingLists(nextLists);
      StorageService.saveShoppingLists(nextLists);
      if (nextLists.length > 0 && !nextLists.some(l => l.id === activeListId)) {
        setActiveListId(nextLists[0].id);
        StorageService.setActiveListId(nextLists[0].id);
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
      await Promise.all(removed.map(receipt => deleteReceiptForUser(user.id, receipt.id)));
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

  const handleSelectTab = (tab: string) => {
    if (tab === 'admin-sources' && !isAdmin) {
      setCurrentTab(user ? 'profile' : 'auth');
      return;
    }
    setCurrentTab(tab);
    if (tab !== 'product-detail') {
      setSelectedProductId(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    if (tab !== 'products' && tab !== 'product-detail') {
      url.searchParams.delete('product');
      url.searchParams.delete('category');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    setCurrentTab('product-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'products');
    url.searchParams.set('product', productId);
    window.history.pushState({}, '', url.toString());
  };

  const handleBackFromDetail = () => {
    setSelectedProductId(null);
    setCurrentTab('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
    url.searchParams.delete('product');
    url.searchParams.set('tab', 'products');
    window.history.pushState({}, '', url.toString());
  };

  const handleNavigateToCategory = (cat: string) => {
    setProductFilterCategory(cat);
    setSelectedProductId(null);
    setCurrentTab('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const url = new URL(window.location.href);
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

    const targetListId = activeList.id === 'list-fallback' ? crypto.randomUUID() : activeList.id;
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
    StorageService.setActiveListId(listId);
  };

  const handleReceiptSaved = async (savedReceipt: Receipt) => {
    if (!user) {
      StorageService.addReceipt(savedReceipt);
      const discoveryCandidates = savedReceipt.items.map((item, index) => ({
        id: `rec-prod-${savedReceipt.id}-${index}`,
        receiptId: savedReceipt.id,
        rawName: item.rawName,
        extractedPrice: item.unitPrice,
        extractedQuantity: item.quantity,
        category: item.category,
        targetSearchStatus: 'pending' as const,
        matchedProductId: item.matchedProductId,
        searchAttempts: 0,
        createdAt: new Date().toISOString()
      }));
      StorageService.addReceiptProducts(discoveryCandidates);
      setReceipts(StorageService.getReceipts());
      setTrackedProductIds(StorageService.getTrackedProducts());
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
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        userProfile={userProfile}
        onUpdateProfile={handleProfileUpdate}
        onSignOut={signOut}
        isAuthenticated={Boolean(user)}
        isAdmin={isAdmin}
        alerts={dashboardAlerts}
        itemsCount={activeList.items.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {dataWriteError && (
          <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {dataWriteError}
          </div>
        )}
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
            onNavigateToAuth={() => setCurrentTab('auth')}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200/80 bg-white py-8 text-xs text-slate-500 no-print pb-20 md:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-800">
              Coșul<span className="text-emerald-600">Meu</span>
            </span>
            <span>• Ghid civic de economisire & comparare prețuri în România</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Monedă: RON (lei)</span>
            <span>• Fus orar: Europe/Bucharest</span>
            <span className="flex items-center gap-1 text-emerald-700 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" /> {user ? 'Date protejate în cont' : 'Date locale pe dispozitiv'}
            </span>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Bar */}
      <MobileNav
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        itemsCount={activeList.items.length}
      />
    </div>
  );
}
