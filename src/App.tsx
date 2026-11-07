import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { MobileNav } from './components/MobileNav.js';
import { DemoNoticeBanner } from './components/DemoNoticeBanner.js';
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
import { ShoppingList, Receipt, UserProfile, PriceAlert } from './types.js';
import { ShieldCheck, Heart } from 'lucide-react';
import { useAuth } from './auth/AuthProvider.js';
import { AuthScreen } from './components/AuthScreen.js';
import { supabase } from './lib/supabase.js';

export default function App() {
  const { user, loading, signOut } = useAuth();
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

          await supabase.from('profiles').upsert(newProfileRow);

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

  // Sync active list
  const activeList =
    shoppingLists.find(l => l.id === activeListId) ||
    shoppingLists[0] || {
      id: 'list-fallback',
      name: 'Coșul Meu',
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

  // Sync tab and product with URL if provided
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const productParam = params.get('product');
    const categoryParam = params.get('category');

    if (categoryParam) {
      setProductFilterCategory(categoryParam);
    }

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

  const handleAddProductToList = (productId: string, productName: string) => {
    const prod = StorageService.getAllProducts().find(p => p.id === productId);
    if (!prod) return;

    setShoppingLists(prevLists => {
      const updated = prevLists.map(list => {
        if (list.id === activeListId) {
          return {
            ...list,
            items: [
              ...list.items,
              {
                id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                productId: prod.id,
                name: prod.name,
                brand: prod.brand,
                category: prod.category,
                quantity: 1,
                unit: prod.defaultUnit,
                checked: false
              }
            ]
          };
        }
        return list;
      });
      StorageService.saveShoppingLists(updated);
      return updated;
    });
  };

  const handleActiveListSelect = (listId: string) => {
    setActiveListId(listId);
    StorageService.setActiveListId(listId);
  };

  const handleReceiptSaved = (savedReceipt: Receipt) => {
    setReceipts(StorageService.getReceipts());
    setTrackedProductIds(StorageService.getTrackedProducts());
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
      {/* Demo notice banner */}
      <DemoNoticeBanner />

      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        userProfile={userProfile}
        onUpdateProfile={handleProfileUpdate}
        onSignOut={signOut}
        isAuthenticated={Boolean(user)}
        isAdmin={isAdmin}
        alerts={priceAlerts}
        itemsCount={activeList.items.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {currentTab === 'auth' && (
          <AuthScreen
            onSuccess={() => setCurrentTab('profile')}
            onCancel={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'dashboard' && (
          <DashboardView
            userProfile={userProfile}
            activeList={activeList}
            receipts={receipts}
            trackedCount={trackedProductIds.length}
            onNavigate={handleSelectTab}
            onOpenReceipt={rec => {
              setCurrentTab('receipts');
            }}
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
            lists={shoppingLists}
            activeList={activeList}
            onUpdateLists={setShoppingLists}
            onSelectActiveList={handleActiveListSelect}
            onCompare={() => handleSelectTab('compare')}
          />
        )}

        {currentTab === 'compare' && (
          <PriceComparisonView
            activeList={activeList}
            onNavigateToList={() => handleSelectTab('shopping-list')}
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
            receipts={receipts}
            onUpdateReceipts={setReceipts}
            onNavigateToScan={() => handleSelectTab('scan-receipt')}
          />
        )}

        {currentTab === 'price-history' && (
          <PriceHistoryView
            alerts={priceAlerts}
            onUpdateAlerts={setPriceAlerts}
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
              <ShieldCheck className="w-3.5 h-3.5" /> Date protejate local
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
