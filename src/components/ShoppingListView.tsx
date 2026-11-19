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
  Split
} from 'lucide-react';
import { ShoppingList, ShoppingListItem, ProductCategory, UnitType, Product, ProductOffer, Store } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { BasketOptimizerPanel } from './BasketOptimizerPanel.js';

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
  onCreateAlertsFromList
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
  const [showListAlertsMenu, setShowListAlertsMenu] = useState(false);
  const optimizerSectionRef = React.useRef<HTMLDivElement>(null);

  // Custom product add modal state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [customCategory, setCustomCategory] = useState<ProductCategory>('Produse de bază');
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customUnit, setCustomUnit] = useState<UnitType>('buc');
  const [customEstPrice, setCustomEstPrice] = useState<number>(10);

  const allCatalogProducts = useMemo(
    () => (catalogProducts && catalogProducts.length > 0 ? catalogProducts : StorageService.getAllProducts()),
    [catalogProducts]
  );

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
    const existingIndex = activeList.items.findIndex(i => i.productId === product.id);

    let updatedItems: ShoppingListItem[];
    if (existingIndex >= 0) {
      // Increment quantity
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
    setSearchQuery('');
  };

  // Add custom unlisted product
  const handleAddCustomProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;

    const newItem: ShoppingListItem = {
      id: crypto.randomUUID(),
      name: customName.trim(),
      brand: customBrand.trim() || undefined,
      category: customCategory,
      quantity: customQuantity,
      unit: customUnit,
      checked: false,
      referencePrice: customEstPrice,
      estimatedPrice: customEstPrice
    };

    const updatedItems = [newItem, ...activeList.items];
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);

    setCustomName('');
    setCustomBrand('');
    setShowCustomModal(false);
    setSearchQuery('');
  };

  // Toggle item check status
  const handleToggleCheck = (itemId: string) => {
    const updatedItems = activeList.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
  };

  // Update quantity
  const handleUpdateQuantity = (itemId: string, delta: number) => {
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
  };

  // Update unit
  const handleUpdateUnit = (itemId: string, newUnit: UnitType) => {
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
    const updatedItems = activeList.items.filter(item => item.id !== itemId);
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, items: updatedItems, updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
  };

  // Clear list
  const handleClearList = () => {
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
    if (!editedListName.trim()) return;
    const updatedLists = lists.map(l =>
      l.id === activeList.id ? { ...l, name: editedListName.trim(), updatedAt: new Date().toISOString() } : l
    );
    saveLists(updatedLists);
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

  // Total estimated
  const totalEstimatedCost = activeList.items.reduce(
    (sum, item) => sum + (item.estimatedPrice || item.referencePrice || 0) * item.quantity,
    0
  );

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

            {isEditingListName ? (
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
            )}

            <button
              onClick={() => setShowNewListModal(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/60 dark:border-emerald-800/70 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Listă nouă
            </button>
          </div>

          {/* List actions: Optimize, Alerts, Duplicate, Copy, Print, Clear */}
          <div className="flex items-center gap-1.5 self-end sm:self-auto no-print">
            {activeList.items.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOptimizer(prev => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  showOptimizer
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
                }`}
                title="Optimizează coșul pe 1, 2 sau 3 magazine"
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

            <button
              onClick={() => setShowClearConfirm(true)}
              className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
              title="Golește lista"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar & Autocomplete */}
        <div className="mt-4 relative no-print">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Caută lapte, ouă, piept de pui, detergent..."
              className="w-full pl-10 pr-28 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-800/90 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden transition-all"
            />
            <button
              onClick={() => {
                setCustomName(searchQuery);
                setShowCustomModal(true);
              }}
              className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              + Produs nou
            </button>
          </div>

          {/* Autocomplete Suggestions Dropdown */}
          {autocompleteSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200/90 dark:border-slate-700 py-2 z-30 animate-in fade-in">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Sugestii din catalog
              </div>
              {autocompleteSuggestions.map(product => (
                <div
                  key={product.id}
                  onClick={() => handleAddCatalogProduct(product)}
                  className="px-4 py-2 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/50 cursor-pointer flex items-center justify-between text-sm transition-colors"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{product.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">({product.brand})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      ~{PriceComparisonService.formatRon(product.baseReferencePrice)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-medium">
                      + Adaugă
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Pills Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-3 pb-1 no-scrollbar no-print">
          <button
            onClick={() => setSelectedCategory('Toate')}
            className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
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
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{cat}</span>
                {count > 0 && <span className="opacity-75">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {showOptimizer && activeList.items.length > 0 ? (
        <div ref={optimizerSectionRef} className="no-print scroll-mt-24">
          <BasketOptimizerPanel
            lists={lists}
            activeList={activeList}
            onSelectActiveList={onSelectActiveList}
            onBackToList={() => setShowOptimizer(false)}
            products={catalogProducts}
            offers={catalogOffers}
            stores={catalogStores}
            initialTransportCost={0}
          />
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
                <span className="text-xs text-slate-500 dark:text-slate-400">Total estimativ:</span>
                <span className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base ml-1.5">
                  {PriceComparisonService.formatRon(totalEstimatedCost)}
                </span>
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
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    className={`p-3.5 sm:p-4 flex items-center justify-between gap-3 transition-colors ${
                      item.checked
                        ? 'bg-slate-50/80 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500'
                        : 'hover:bg-slate-50/40 dark:hover:bg-slate-800/40 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {/* Left: Checkbox & Name */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        onClick={() => handleToggleCheck(item.id)}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                          item.checked
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 dark:border-slate-600 hover:border-emerald-500 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {item.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>

                      <div className="min-w-0">
                        <span
                          className={`text-sm font-semibold block truncate ${
                            item.checked ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {item.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
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
                      </div>
                    </div>

                    {/* Right: Quantity Stepper & Unit Selector & Remove */}
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0 no-print">
                      {/* Quantity Stepper */}
                      <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 overflow-hidden">
                        <button
                          onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? -0.5 : -1)}
                          className="px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold cursor-pointer"
                          title="Scade cantitatea"
                        >
                          -
                        </button>
                        <span className="px-2 text-xs font-bold text-slate-800 dark:text-slate-100 min-w-[28px] text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? 0.5 : 1)}
                          className="px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold cursor-pointer"
                          title="Crește cantitatea"
                        >
                          +
                        </button>
                      </div>

                      {/* Unit Selector */}
                      <select
                        value={item.unit}
                        onChange={e => handleUpdateUnit(item.id, e.target.value as UnitType)}
                        className="text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-1 px-1.5 focus:outline-hidden cursor-pointer"
                      >
                        {UNITS.map(u => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                        title="Șterge produsul"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Primary Compare & Optimize CTA Bar */}
          {activeList.items.length > 0 && (
            <div className="sticky bottom-16 md:bottom-6 z-30 pt-2 no-print">
              <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-emerald-200/90 dark:border-emerald-800/70 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="tabular-nums">
                  <span className="text-xs text-slate-500 dark:text-slate-400 block">Total estimat · {activeList.name}</span>
                  <span className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                    {PriceComparisonService.formatRon(totalEstimatedCost)}
                  </span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setShowOptimizer(true)}
                    className="py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-1.5 border bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70 transition-colors cursor-pointer"
                  >
                    <Split className="w-4 h-4" />
                    <span>Optimizează coșul</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCompare}
                    className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 fill-white" />
                    <span>Compară prețurile</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Adaugă Produs Nou Personalizat */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Adaugă produs personalizat</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Produsul va fi adăugat în lista activă și va fi salvat pentru comparații.
            </p>

            <form onSubmit={handleAddCustomProduct} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Denumire produs *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="ex: Mere Ionatan, Ciocolată neagră..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Marcă (opțional)</label>
                  <input
                    type="text"
                    value={customBrand}
                    onChange={e => setCustomBrand(e.target.value)}
                    placeholder="ex: Milka, Marcă proprie"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Categorie</label>
                  <select
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Cantitate</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customQuantity}
                    onChange={e => setCustomQuantity(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Unitate</label>
                  <select
                    value={customUnit}
                    onChange={e => setCustomUnit(e.target.value as UnitType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    {UNITS.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Preț estimat (lei)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={customEstPrice}
                    onChange={e => setCustomEstPrice(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Creează o listă nouă</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Dă un nume noii tale liste de cumpărături (ex: Grătar duminică).
            </p>
            <form onSubmit={handleCreateNewList} className="mt-4 space-y-4">
              <input
                type="text"
                required
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                placeholder="Numele listei..."
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Ești sigur că vrei să golești lista?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Toate cele {activeList.items.length} produse din „{activeList.name}” vor fi șterse.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Renunță
              </button>
              <button
                onClick={handleClearList}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-xs cursor-pointer"
              >
                Da, golește lista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
