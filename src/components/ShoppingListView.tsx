import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Printer,
  Check,
  Search,
  Sparkles,
  ChevronDown,
  Edit2,
  MoreVertical,
  Layers,
  ArrowRight,
  Archive,
  CheckCircle2,
  Tag,
  AlertTriangle,
  RotateCcw,
  Bell,
  Split,
  Bot,
  Barcode,
  Users,
  Lock,
  ArrowRightLeft,
  Radio
} from 'lucide-react';
import {
  ShoppingList,
  ShoppingListItem,
  ProductCategory,
  UnitType,
  Product,
  ProductOffer,
  Store,
  ProductAlternativeRecommendation
} from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { ProductAlternativesService } from '../services/ProductAlternativesService.js';
import { STORES as MOCK_STORES } from '../data/mockData.js';
import { BasketOptimizerPanel } from './BasketOptimizerPanel.js';
import { SharedListModal } from './SharedListModal.js';
import { BarcodeScannerModal } from './BarcodeScannerModal.js';
import { ShoppingAssistantPanel } from './ShoppingAssistantPanel.js';

interface ShoppingListViewProps {
  lists: ShoppingList[];
  activeList: ShoppingList;
  onUpdateLists: (lists: ShoppingList[]) => void;
  onSelectActiveList: (listId: string) => void;
  onCompare: () => void;
  catalogProducts?: Product[];
  catalogOffers?: ProductOffer[];
  catalogStores?: Store[];
  onCreateAlertsFromList?: (
    list: ShoppingList,
    options?: { alertType?: 'below_target' | 'any_drop' | 'interval_low'; intervalDays?: 30 | 90 | 180 | 365 }
  ) => void;
  isAuthenticated?: boolean;
  accessToken?: string;
  currentUserId?: string;
  useLoyaltyCards?: boolean;
  userCity?: string;
  realtimeConnected?: boolean;
  onCollaborationUpdated?: () => void;
  onAddProductToList?: (productId: string, productName: string, productData?: Product) => Promise<boolean>;
  onSelectProduct?: (productId: string) => void;
}

const CATEGORIES: ProductCategory[] = [
  'Fructe și legume',
  'Lactate și ouă',
  'Carne și pește',
  'Panificație',
  'Băuturi',
  'Produse congelate',
  'Produse de bază',
  'Curățenie',
  'Igienă personală',
  'Alte produse'
];

const UNITS: UnitType[] = ['buc', 'kg', 'g', 'l', 'ml', 'pachet'];

export const ShoppingListView: React.FC<ShoppingListViewProps> = ({
  lists,
  activeList,
  onUpdateLists,
  onSelectActiveList,
  onCompare,
  catalogProducts,
  catalogOffers,
  catalogStores,
  onCreateAlertsFromList,
  isAuthenticated = false,
  accessToken,
  currentUserId,
  useLoyaltyCards = true,
  userCity,
  realtimeConnected = false,
  onCollaborationUpdated,
  onAddProductToList,
  onSelectProduct
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Toate');
  const [isEditingListName, setIsEditingListName] = useState(false);
  const [editedListName, setEditedListName] = useState(activeList.name);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optimizerScope, setOptimizerScope] = useState<'single' | 'multi'>('multi');
  const [showListAlertsMenu, setShowListAlertsMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const optimizerSectionRef = React.useRef<HTMLDivElement>(null);

  const isReadOnlyViewer = activeList.myRole === 'viewer';
  const isUuidList = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeList.id);

  const logListActivity = (
    action: 'item_added' | 'item_updated' | 'item_checked' | 'item_unchecked' | 'item_removed' | 'list_renamed',
    itemName?: string,
    details?: Record<string, unknown>
  ) => {
    if (!isAuthenticated || !accessToken || !isUuidList || !activeList.isShared) return;
    void fetch(`/api/lists/${encodeURIComponent(activeList.id)}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ action, itemName, details })
    }).catch(() => {
      // Best-effort collaboration feed logging
    });
  };

  // Custom product add modal state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [customCategory, setCustomCategory] = useState<ProductCategory>('Produse de bază');
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customUnit, setCustomUnit] = useState<UnitType>('buc');
  const [customEstPrice, setCustomEstPrice] = useState<string>('');

  const allCatalogProducts = useMemo(
    () => (catalogProducts && catalogProducts.length > 0 ? catalogProducts : StorageService.getAllProducts()),
    [catalogProducts]
  );
  const allCatalogOffers = useMemo(
    () => (catalogOffers && catalogOffers.length > 0 ? catalogOffers : StorageService.getProductOffers()),
    [catalogOffers]
  );
  const allCatalogStores = useMemo(
    () => (catalogStores && catalogStores.length > 0 ? catalogStores : MOCK_STORES),
    [catalogStores]
  );

  // Cheaper compatible alternatives per catalog-matched item in activeList
  const cheaperAltByItemId = useMemo(() => {
    const map = new Map<string, ProductAlternativeRecommendation>();
    for (const item of activeList.items) {
      if (!item.productId) continue;
      const targetProduct = allCatalogProducts.find(p => p.id === item.productId);
      if (!targetProduct) continue;
      const altRes = ProductAlternativesService.getAlternatives({
        targetProduct,
        allProducts: allCatalogProducts,
        allOffers: allCatalogOffers,
        stores: allCatalogStores,
        useLoyaltyCards,
        limitPerGroup: 2
      });
      const best = altRes?.cheaperNormalizedAlternatives?.[0];
      if (best && best.savingsPercent >= 3) {
        map.set(item.id, best);
      }
    }
    return map;
  }, [activeList.items, allCatalogProducts, allCatalogOffers, allCatalogStores, useLoyaltyCards]);

  // Filter autocomplete suggestions based on search query
  const autocompleteSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    return allCatalogProducts.filter(
      p => p.name.toLowerCase().includes(query) || p.brand.toLowerCase().includes(query)
    ).slice(0, 6);
  }, [searchQuery, allCatalogProducts]);

  // Filter current list items by category & search
  const filteredItems = useMemo(() => {
    return activeList.items.filter(item => {
      const matchesCategory = selectedCategory === 'Toate' || item.category === selectedCategory;
      const matchesSearch = !searchQuery.trim() || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeList.items, selectedCategory, searchQuery]);

  // Helper to save current lists
  const saveLists = (updatedLists: ShoppingList[]) => {
    onUpdateLists(updatedLists);
  };

  // Add catalog product to active list
  const handleAddCatalogProduct = (product: Product) => {
    if (isReadOnlyViewer) return;
    const existingIndex = activeList.items.findIndex(i => i.productId === product.id);

    let updatedItems: ShoppingListItem[];
    if (existingIndex >= 0) {
      updatedItems = activeList.items.map((item, idx) =>
        idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
      );
    } else {
      const newItem: ShoppingListItem = {
        id: crypto.randomUUID(),
        productId: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        quantity: 1,
        unit: product.defaultUnit,
        checked: false,
        barcode: product.barcode,
        referencePrice: product.baseReferencePrice,
        estimatedPrice: product.baseReferencePrice
      };
      updatedItems = [newItem, ...activeList.items];
    }

    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    logListActivity('item_added', product.name);
    setSearchQuery('');
  };

  // Replace an item with a cheaper compatible alternative
  const handleReplaceWithAlternative = (itemId: string, alt: ProductAlternativeRecommendation) => {
    if (isReadOnlyViewer) return;
    const updatedItems = activeList.items.map(item =>
      item.id === itemId
        ? {
            ...item,
            productId: alt.product.id,
            name: alt.product.name,
            brand: alt.product.brand,
            category: alt.product.category,
            unit: alt.product.defaultUnit || item.unit,
            barcode: alt.product.barcode,
            referencePrice: alt.price,
            estimatedPrice: alt.price
          }
        : item
    );
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    logListActivity('item_updated', alt.product.name, { replacedItemId: itemId });
  };

  // Add custom unlisted product
  const handleAddCustomProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyViewer || !customName.trim()) return;

    const parsedCustomPrice = customEstPrice.trim() ? parseFloat(customEstPrice) : NaN;
    const validCustomPrice = Number.isFinite(parsedCustomPrice) && parsedCustomPrice > 0 ? parsedCustomPrice : undefined;

    const newItem: ShoppingListItem = {
      id: crypto.randomUUID(),
      name: customName.trim(),
      brand: customBrand.trim() || undefined,
      category: customCategory,
      quantity: customQuantity,
      unit: customUnit,
      checked: false,
      referencePrice: validCustomPrice,
      estimatedPrice: validCustomPrice
    };

    const updatedItems = [newItem, ...activeList.items];
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    logListActivity('item_added', newItem.name);

    setCustomName('');
    setCustomBrand('');
    setCustomEstPrice('');
    setShowCustomModal(false);
    setSearchQuery('');
  };

  // Toggle item check status
  const handleToggleCheck = (itemId: string) => {
    if (isReadOnlyViewer) return;
    const targetItem = activeList.items.find(i => i.id === itemId);
    const updatedItems = activeList.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    if (targetItem) {
      logListActivity(targetItem.checked ? 'item_unchecked' : 'item_checked', targetItem.name);
    }
  };

  // Update quantity
  const handleUpdateQuantity = (itemId: string, delta: number) => {
    if (isReadOnlyViewer) return;
    const targetItem = activeList.items.find(i => i.id === itemId);
    const updatedItems = activeList.items
      .map(item => {
        if (item.id === itemId) {
          const newQty = Math.max(0.25, Math.round((item.quantity + delta) * 100) / 100);
          return { ...item, quantity: newQty };
        }
        return item;
      })
      .filter(item => item.quantity > 0);

    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    if (targetItem) {
      logListActivity('item_updated', targetItem.name, { delta });
    }
  };

  // Update unit
  const handleUpdateUnit = (itemId: string, newUnit: UnitType) => {
    if (isReadOnlyViewer) return;
    const updatedItems = activeList.items.map(item =>
      item.id === itemId ? { ...item, unit: newUnit } : item
    );
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
  };

  // Remove item
  const handleRemoveItem = (itemId: string) => {
    if (isReadOnlyViewer) return;
    const targetItem = activeList.items.find(i => i.id === itemId);
    const updatedItems = activeList.items.filter(item => item.id !== itemId);
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    if (targetItem) {
      logListActivity('item_removed', targetItem.name);
    }
  };

  // Clear list
  const handleClearList = () => {
    if (isReadOnlyViewer) return;
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: [], updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    setShowClearConfirm(false);
  };

  // Duplicate list
  const handleDuplicateList = () => {
    const duplicated: ShoppingList = {
      id: crypto.randomUUID(),
      name: `${activeList.name} (Copie)`,
      items: activeList.items.map(i => ({ ...i, id: crypto.randomUUID(), checked: false })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const updatedLists = [...lists, duplicated];
    saveLists(updatedLists);
    onSelectActiveList(duplicated.id);
  };

  // Create new list
  const handleCreateNewList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    const newList: ShoppingList = {
      id: crypto.randomUUID(),
      name: newListName.trim(),
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const updatedLists = [...lists, newList];
    saveLists(updatedLists);
    onSelectActiveList(newList.id);
    setNewListName('');
    setShowNewListModal(false);
  };

  // Rename list
  const handleSaveListName = () => {
    if (isReadOnlyViewer || activeList.myRole === 'editor' || !editedListName.trim()) return;
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, name: editedListName.trim(), updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
    logListActivity('list_renamed', editedListName.trim());
    setIsEditingListName(false);
  };

  // Copy list to clipboard formatted as text
  const handleCopyClipboard = () => {
    const text = `🛒 Coșul Meu - ${activeList.name}\n\n` +
      activeList.items
        .map(i => `${i.checked ? '✓' : '☐'} ${i.name} (${i.quantity} ${i.unit})${i.brand ? ` - ${i.brand}` : ''}`)
        .join('\n') +
      `\n\nTotal estimat: ${PriceComparisonService.formatRon(
        activeList.items.reduce((s, i) => s + (i.estimatedPrice || 0) * i.quantity, 0)
      )}`;

    navigator.clipboard.writeText(text);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 2000);
  };

  // Total estimated & unpriced items tracking (never invent fallback prices)
  const totalEstimatedCost = activeList.items.reduce(
    (sum, item) => sum + ((item.estimatedPrice && item.estimatedPrice > 0 ? item.estimatedPrice : item.referencePrice && item.referencePrice > 0 ? item.referencePrice : 0) * item.quantity),
    0
  );
  const unpricedItemsCount = activeList.items.filter(
    item => !(item.estimatedPrice && item.estimatedPrice > 0) && !(item.referencePrice && item.referencePrice > 0)
  ).length;

  const checkedCount = activeList.items.filter(i => i.checked).length;

  return (
    <div className="space-y-6 pb-16">
      {/* Top Header: List selector & List actions */}
      <div className="surface-card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* List switcher & Editable name */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={activeList.id}
                onChange={e => onSelectActiveList(e.target.value)}
                className="appearance-none bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold text-sm sm:text-base py-2 pl-3 pr-8 rounded-xl border border-transparent dark:border-slate-700 cursor-pointer focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
              >
                {lists.map(list => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.items.length})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>

            {!isReadOnlyViewer && activeList.myRole !== 'editor' && (
              isEditingListName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={editedListName}
                    onChange={e => setEditedListName(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-emerald-500 bg-white dark:bg-slate-800 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveListName}
                    className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditedListName(activeList.name);
                    setIsEditingListName(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  title="Redenumește lista"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )
            )}

            <button
              onClick={() => setShowNewListModal(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/60 dark:border-emerald-800/70 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Listă nouă
            </button>
          </div>

          {/* List actions: AI, Scan, Share, Optimize, Alerts, Duplicate, Copy, Print, Clear */}
          <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-auto no-print">
            <button
              type="button"
              onClick={() => setShowAssistant(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                showAssistant
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/70'
              }`}
              title="Asistent inteligent de cumpărături"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Asistent AI</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBarcodeModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer"
              title="Scanează cod de bare EAN/UPC"
            >
              <Barcode className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Scanează</span>
            </button>

            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer"
              title="Partajează lista și gestionează colaboratorii"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Partajează</span>
              {activeList.isShared && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {activeList.members?.length || 1}
                </span>
              )}
              {realtimeConnected && isUuidList && (
                <span title="Sincronizare Live activă" className="inline-flex items-center">
                  <Radio className="w-3 h-3 text-emerald-500" aria-label="Sincronizare Live activă" />
                </span>
              )}
            </button>

            {(activeList.items.length > 0 || showOptimizer) && (
              <button
                type="button"
                onClick={() => setShowOptimizer(prev => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  showOptimizer
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
                }`}
                title="Optimizează coșul (1 supermarket sau multi-magazin)"
              >
                <Split className="w-3.5 h-3.5" />
                <span>{showOptimizer ? 'Vezi lista' : 'Optimizează coșul'}</span>
              </button>
            )}

            {onCreateAlertsFromList && activeList.items.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowListAlertsMenu(prev => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/70 dark:border-emerald-800/70 transition-colors cursor-pointer"
                  title="Creează alerte de preț pentru produsele din această listă"
                  aria-expanded={showListAlertsMenu}
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Creează alerte</span>
                </button>
                {showListAlertsMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 z-40">
                    <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Tip alertă pentru listă
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onCreateAlertsFromList(activeList, { alertType: 'below_target' });
                        setShowListAlertsMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                    >
                      Preț maxim dorit (-10% față de minim)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCreateAlertsFromList(activeList, { alertType: 'any_drop' });
                        setShowListAlertsMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                    >
                      Alertă la orice reducere de preț
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCreateAlertsFromList(activeList, { alertType: 'interval_low', intervalDays: 90 });
                        setShowListAlertsMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                    >
                      Minim istoric (90 zile)
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleDuplicateList}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Duplică lista"
            >
              <Copy className="w-4 h-4" />
            </button>

            <button
              onClick={handleCopyClipboard}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative cursor-pointer"
              title="Copiază lista în clipboard"
            >
              {copiedFeedback ? (
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 px-1">Copiat!</span>
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => window.print()}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Tipărește lista (Print)"
            >
              <Printer className="w-4 h-4" />
            </button>

            {!isReadOnlyViewer && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                title="Golește lista"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Viewer read-only indicator */}
        {isReadOnlyViewer && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>Acces doar citire (Viewer) — poți vizualiza lista și comparațiile în timp real, fără drepturi de modificare.</span>
          </div>
        )}

        {/* Search Bar & Autocomplete */}
        <div className="mt-4 relative no-print">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              disabled={isReadOnlyViewer}
              placeholder={isReadOnlyViewer ? 'Filtrare produse în listă (acces viewer)...' : 'Caută lapte, ouă, piept de pui, detergent...'}
              className="w-full pl-10 pr-28 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-800/90 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden transition-all disabled:opacity-60"
            />
            {!isReadOnlyViewer && (
              <button
                onClick={() => {
                  setCustomName(searchQuery);
                  setShowCustomModal(true);
                }}
                className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                + Produs nou
              </button>
            )}
          </div>

          {/* Autocomplete Suggestions Dropdown */}
          {autocompleteSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200/90 dark:border-slate-700 py-2 z-30 animate-in fade-in">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Sugestii din catalog
              </div>
              {autocompleteSuggestions.map(product => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleAddCatalogProduct(product)}
                  className="w-full text-left px-4 py-2.5 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/50 cursor-pointer flex items-center justify-between gap-2 text-sm transition-colors"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{product.name}</span>
                    {product.brand && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">({product.brand})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      ~{PriceComparisonService.formatRon(product.baseReferencePrice)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold">
                      + Adaugă
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-3 pb-1 no-scrollbar no-print">
          <button
            type="button"
            aria-pressed={selectedCategory === 'Toate'}
            onClick={() => setSelectedCategory('Toate')}
            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedCategory === 'Toate'
                ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            Toate ({activeList.items.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = activeList.items.filter(i => i.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={selectedCategory === cat}
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{cat}</span>
                {count > 0 && <span className="opacity-75 tabular-nums">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Embedded Shopping AI Assistant Panel */}
      {showAssistant && (
        <div className="no-print">
          <ShoppingAssistantPanel
            open={showAssistant}
            onClose={() => setShowAssistant(false)}
            activeList={activeList}
            catalogProducts={allCatalogProducts}
            accessToken={accessToken}
            useLoyaltyCards={useLoyaltyCards}
            onAddProductToList={async (productId, productName, productData) => {
              if (isReadOnlyViewer) return false;
              if (onAddProductToList) {
                const ok = await onAddProductToList(productId, productName, productData);
                if (ok) logListActivity('item_added', productName);
                return ok;
              }
              if (productData) {
                handleAddCatalogProduct(productData);
                return true;
              }
              return false;
            }}
          />
        </div>
      )}

      {showOptimizer ? (
        <div ref={optimizerSectionRef} className="no-print scroll-mt-24 space-y-3">
          <div className="surface-card p-3 sm:px-5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Mod optimizare coș
            </span>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setOptimizerScope('single')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  optimizerScope === 'single'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700'
                }`}
              >
                1 supermarket (FAZA 2.1)
              </button>
              <button
                type="button"
                onClick={() => setOptimizerScope('multi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  optimizerScope === 'multi'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700'
                }`}
              >
                Multi-magazin (2–3+ / toate)
              </button>
            </div>
          </div>

          {optimizerScope === 'single' ? (
            <BasketOptimizerPanel
              lists={lists}
              activeList={activeList}
              onSelectActiveList={onSelectActiveList}
              onBackToList={() => setShowOptimizer(false)}
              products={catalogProducts}
              offers={catalogOffers}
              stores={catalogStores}
              initialTransportCost={0}
              initialMaxStores={1}
              singleStoreOnly={true}
              defaultRegion={userCity}
            />
          ) : (
            <BasketOptimizerPanel
              lists={lists}
              activeList={activeList}
              onSelectActiveList={onSelectActiveList}
              onBackToList={() => setShowOptimizer(false)}
              products={catalogProducts}
              offers={catalogOffers}
              stores={catalogStores}
              initialTransportCost={0}
              initialMaxStores={3}
              singleStoreOnly={false}
              defaultRegion={userCity}
            />
          )}
        </div>
      ) : (
        <>
          {/* Main List Items Section */}
          <div className="surface-card overflow-hidden">
            {/* Printable Header */}
            <div className="hidden print-only p-4 border-b">
              <h1 className="font-display text-xl font-bold">Coșul Meu - {activeList.name}</h1>
              <p className="text-xs text-gray-500 tabular-nums">
                Generat la {new Date().toLocaleDateString('ro-RO')} · Total estimat: {PriceComparisonService.formatRon(totalEstimatedCost)}
              </p>
            </div>

            <div className="p-4 sm:p-5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-2.5 tabular-nums">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Produse ({filteredItems.length})
                </span>
                {checkedCount > 0 && (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                    · {checkedCount} bifate
                  </span>
                )}
              </div>
              <div className="text-right tabular-nums">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {unpricedItemsCount > 0 ? 'Subtotal estimativ:' : 'Total estimativ:'}
                </span>
                <span className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base ml-1.5">
                  {PriceComparisonService.formatRon(totalEstimatedCost)}
                </span>
                {unpricedItemsCount > 0 && (
                  <span className="block text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                    {unpricedItemsCount} fără preț de referință
                  </span>
                )}
              </div>
            </div>

            {/* Empty State */}
            {filteredItems.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3 border border-transparent dark:border-emerald-800/60">
                  <Plus className="w-6 h-6" />
                </div>
                <h3 className="font-display text-sm font-bold text-slate-800 dark:text-slate-100">Niciun produs în această listă</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                  Folosește bara de căutare de mai sus pentru a adăuga produse din catalog sau creează un produs propriu.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map(item => {
                  const cheaperAlt = cheaperAltByItemId.get(item.id);
                  return (
                  <div
                    key={item.id}
                    className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 transition-colors ${
                      item.checked
                        ? 'bg-slate-50/80 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500'
                        : 'hover:bg-slate-50/40 dark:hover:bg-slate-800/40 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {/* Left: Checkbox & Name */}
                    <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={isReadOnlyViewer}
                        onClick={() => handleToggleCheck(item.id)}
                        aria-label={item.checked ? `Debifează ${item.name}` : `Bifează ${item.name}`}
                        aria-pressed={item.checked}
                        className={`min-w-[36px] min-h-[36px] -ml-1.5 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                          isReadOnlyViewer ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                            item.checked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                          }`}
                        >
                          {item.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </span>
                      </button>

                      <div className="min-w-0 flex-1">
                        <span
                          className={`text-sm font-semibold block truncate ${
                            item.checked ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {item.name}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {item.brand && (
                            <>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{item.brand}</span>
                              <span>·</span>
                            </>
                          )}
                          <span>{item.category}</span>
                          {item.estimatedPrice && (
                            <span>· ~{PriceComparisonService.formatRon(item.estimatedPrice * item.quantity)}</span>
                          )}
                        </div>
                        {cheaperAlt && !item.checked && (
                          <div className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] text-emerald-800 dark:text-emerald-300">
                            <ArrowRightLeft className="w-3 h-3 shrink-0" />
                            <span>
                              Alternativă ({cheaperAlt.kindLabelRo.toLowerCase()}): <strong>{cheaperAlt.product.name}</strong> (-{cheaperAlt.savingsPercent.toFixed(0)}% / {cheaperAlt.normalizedUnitLabel} la {cheaperAlt.store.name})
                            </span>
                            {!isReadOnlyViewer && (
                              <button
                                type="button"
                                onClick={() => handleReplaceWithAlternative(item.id, cheaperAlt)}
                                className="ml-1 font-extrabold underline hover:text-emerald-600 dark:hover:text-emerald-200 cursor-pointer"
                              >
                                Înlocuiește
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Quantity Stepper & Unit Selector & Remove */}
                    <div className="flex items-center justify-end gap-2 sm:gap-3 shrink-0 pl-9 sm:pl-0 no-print">
                      {/* Quantity Stepper */}
                      <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 overflow-hidden">
                        <button
                          type="button"
                          disabled={isReadOnlyViewer}
                          onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? -0.5 : -1)}
                          aria-label={`Scade cantitatea pentru ${item.name}`}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Scade cantitatea"
                        >
                          -
                        </button>
                        <span className="px-2 text-xs font-bold text-slate-800 dark:text-slate-100 min-w-[30px] text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={isReadOnlyViewer}
                          onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? 0.5 : 1)}
                          aria-label={`Crește cantitatea pentru ${item.name}`}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Crește cantitatea"
                        >
                          +
                        </button>
                      </div>

                      {/* Unit Selector */}
                      <select
                        disabled={isReadOnlyViewer}
                        value={item.unit}
                        onChange={e => handleUpdateUnit(item.id, e.target.value as UnitType)}
                        aria-label={`Unitate măsură pentru ${item.name}`}
                        className="min-h-[36px] text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-1 px-2 focus:outline-hidden cursor-pointer disabled:opacity-50"
                      >
                        {UNITS.map(u => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>

                      {/* Delete Button */}
                      {!isReadOnlyViewer && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          aria-label={`Șterge ${item.name} din listă`}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                          title="Șterge produsul"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Primary Compare & Optimize CTA Bar */}
          {activeList.items.length > 0 && (
            <div className="sticky bottom-16 md:bottom-6 z-30 pt-2 no-print">
              <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-emerald-200/90 dark:border-emerald-800/70 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="tabular-nums min-w-0">
                  <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">
                    {unpricedItemsCount > 0
                      ? `Subtotal estimat (${unpricedItemsCount} fără preț) · ${activeList.name}`
                      : `Total estimat · ${activeList.name}`}
                  </span>
                  <span className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                    {PriceComparisonService.formatRon(totalEstimatedCost)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowOptimizer(true);
                      requestAnimationFrame(() => {
                        optimizerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      });
                    }}
                    className="flex-1 sm:flex-initial min-h-[42px] py-2 px-3.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 border bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70 transition-colors cursor-pointer whitespace-nowrap"
                    title="Optimizează coșul într-un singur supermarket"
                  >
                    <Split className="w-4 h-4 shrink-0" />
                    <span>Optimizează coșul</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCompare}
                    className="flex-1 sm:flex-initial min-h-[42px] py-2 px-4 sm:px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>Compară prețurile</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Adaugă Produs Nou Personalizat */}
      {showCustomModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-product-modal-title"
          className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <h3 id="custom-product-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Adaugă produs personalizat
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Produsul va fi adăugat în lista activă și va fi salvat pentru comparații.
            </p>

            <form onSubmit={handleAddCustomProduct} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="custom-product-name" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Denumire produs *
                </label>
                <input
                  id="custom-product-name"
                  type="text"
                  required
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="ex: Mere Ionatan, Ciocolată neagră..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="custom-product-brand" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Marcă (opțional)
                  </label>
                  <input
                    id="custom-product-brand"
                    type="text"
                    value={customBrand}
                    onChange={e => setCustomBrand(e.target.value)}
                    placeholder="ex: Milka, Marcă proprie"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label htmlFor="custom-product-category" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Categorie
                  </label>
                  <select
                    id="custom-product-category"
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                <div>
                  <label htmlFor="custom-product-qty" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Cantitate
                  </label>
                  <input
                    id="custom-product-qty"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customQuantity}
                    onChange={e => setCustomQuantity(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label htmlFor="custom-product-unit" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Unitate
                  </label>
                  <select
                    id="custom-product-unit"
                    value={customUnit}
                    onChange={e => setCustomUnit(e.target.value as UnitType)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {UNITS.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="custom-product-price" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Preț (lei)
                  </label>
                  <input
                    id="custom-product-price"
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="—"
                    value={customEstPrice}
                    onChange={e => setCustomEstPrice(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="min-h-[40px] px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
                >
                  Adaugă în listă
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Creare Listă Nouă */}
      {showNewListModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-list-modal-title"
          className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <h3 id="new-list-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Creează o listă nouă
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Dă un nume noii tale liste de cumpărături (ex: Grătar duminică).
            </p>
            <form onSubmit={handleCreateNewList} className="mt-4 space-y-4">
              <div>
                <label htmlFor="new-list-name-input" className="sr-only">
                  Numele listei noi
                </label>
                <input
                  id="new-list-name-input"
                  type="text"
                  required
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="Numele listei..."
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="min-h-[40px] px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
                >
                  Creează lista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmare Golire Listă */}
      {showClearConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-list-modal-title"
          className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 id="clear-list-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              Ești sigur că vrei să golești lista?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Toate cele {activeList.items.length} produse din „{activeList.name}” vor fi șterse.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Renunță
              </button>
              <button
                type="button"
                onClick={handleClearList}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
              >
                Da, golește lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V2 Modals: Shared List & Barcode Scanner */}
      <SharedListModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        activeList={activeList}
        isAuthenticated={isAuthenticated}
        accessToken={accessToken}
        currentUserId={currentUserId}
        onCollaborationUpdated={onCollaborationUpdated}
      />

      <BarcodeScannerModal
        open={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
        accessToken={accessToken}
        onAddToList={async (productId, productName, productData) => {
          if (isReadOnlyViewer) return false;
          if (onAddProductToList) {
            const ok = await onAddProductToList(productId, productName, productData);
            if (ok) logListActivity('item_added', productName);
            return ok;
          }
          if (productData) {
            handleAddCatalogProduct(productData);
            return true;
          }
          return false;
        }}
        onViewProduct={id => {
          setShowBarcodeModal(false);
          if (onSelectProduct) onSelectProduct(id);
        }}
      />
    </div>
  );
};
