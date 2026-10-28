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
  RotateCcw
} from 'lucide-react';
import { ShoppingList, ShoppingListItem, ProductCategory, UnitType, Product } from '../types';
import { StorageService } from '../services/StorageService';
import { PriceComparisonService } from '../services/PriceComparisonService';

interface ShoppingListViewProps {
  lists: ShoppingList[];
  activeList: ShoppingList;
  onUpdateLists: (lists: ShoppingList[]) => void;
  onSelectActiveList: (listId: string) => void;
  onCompare: () => void;
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
  onCompare
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Toate');
  const [isEditingListName, setIsEditingListName] = useState(false);
  const [editedListName, setEditedListName] = useState(activeList.name);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  // Custom product add modal state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [customCategory, setCustomCategory] = useState<ProductCategory>('Produse de bază');
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customUnit, setCustomUnit] = useState<UnitType>('buc');
  const [customEstPrice, setCustomEstPrice] = useState<number>(10);

  const allCatalogProducts = useMemo(() => StorageService.getAllProducts(), []);

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
    StorageService.saveShoppingLists(updatedLists);
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
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
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
      id: `item-custom-${Date.now()}`,
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
      id: `list-${Date.now()}`,
      name: `${activeList.name} (Copie)`,
      items: activeList.items.map(i => ({ ...i, id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, checked: false })),
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
      id: `list-${Date.now()}`,
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
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* List switcher & Editable name */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={activeList.id}
                onChange={e => onSelectActiveList(e.target.value)}
                className="appearance-none bg-slate-100 hover:bg-slate-200/80 text-slate-900 font-bold text-sm sm:text-base py-2 pl-3 pr-8 rounded-xl border-none cursor-pointer focus:ring-2 focus:ring-emerald-500"
              >
                {lists.map(list => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.items.length})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-3 pointer-events-none" />
            </div>

            {isEditingListName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={editedListName}
                  onChange={e => setEditedListName(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-500 text-sm font-bold text-slate-900 focus:outline-hidden"
                  autoFocus
                />
                <button
                  onClick={handleSaveListName}
                  className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Redenumește lista"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setShowNewListModal(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60"
            >
              <Plus className="w-3.5 h-3.5" /> Listă nouă
            </button>
          </div>

          {/* List actions: Duplicate, Copy, Print, Clear */}
          <div className="flex items-center gap-1.5 self-end sm:self-auto no-print">
            <button
              onClick={handleDuplicateList}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
              title="Duplică lista"
            >
              <Copy className="w-4 h-4" />
            </button>

            <button
              onClick={handleCopyClipboard}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
              title="Copiază lista în clipboard"
            >
              {copiedFeedback ? (
                <span className="text-[11px] font-bold text-emerald-600 px-1">Copiat!</span>
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => window.print()}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
              title="Tipărește lista (Print)"
            >
              <Printer className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowClearConfirm(true)}
              className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
              title="Golește lista"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar & Autocomplete */}
        <div className="mt-4 relative no-print">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Caută lapte, ouă, piept de pui, detergent..."
              className="w-full pl-10 pr-28 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm transition-all"
            />
            <button
              onClick={() => {
                setCustomName(searchQuery);
                setShowCustomModal(true);
              }}
              className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
            >
              + Produs nou
            </button>
          </div>

          {/* Autocomplete Suggestions Dropdown */}
          {autocompleteSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-2 z-30 animate-in fade-in">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Sugestii din catalog
              </div>
              {autocompleteSuggestions.map(product => (
                <div
                  key={product.id}
                  onClick={() => handleAddCatalogProduct(product)}
                  className="px-4 py-2 hover:bg-emerald-50/70 cursor-pointer flex items-center justify-between text-sm transition-colors"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{product.name}</span>
                    <span className="text-xs text-slate-500 ml-2">({product.brand})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-700">
                      ~{PriceComparisonService.formatRon(product.baseReferencePrice)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
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
            className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedCategory === 'Toate'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{cat}</span>
                {count > 0 && <span className="opacity-75">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main List Items Section */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Printable Header */}
        <div className="hidden print-only p-4 border-b">
          <h1 className="text-xl font-bold">Coșul Meu - {activeList.name}</h1>
          <p className="text-xs text-gray-500">
            Generat la {new Date().toLocaleDateString('ro-RO')} • Total estimat: {PriceComparisonService.formatRon(totalEstimatedCost)}
          </p>
        </div>

        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Produse ({filteredItems.length})
            </span>
            {checkedCount > 0 && (
              <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                {checkedCount} bifate
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500">Total estimativ:</span>
            <span className="font-extrabold text-slate-900 text-sm sm:text-base ml-1.5">
              {PriceComparisonService.formatRon(totalEstimatedCost)}
            </span>
          </div>
        </div>

        {/* Empty State */}
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Plus className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Niciun produs în această listă</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Folosește bara de căutare de mai sus pentru a adăuga produse din catalog sau creează un produs propriu.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredItems.map(item => (
              <div
                key={item.id}
                className={`p-3.5 sm:p-4 flex items-center justify-between gap-3 transition-colors ${
                  item.checked ? 'bg-slate-50/80 text-slate-400' : 'hover:bg-slate-50/40 text-slate-900'
                }`}
              >
                {/* Left: Checkbox & Name */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => handleToggleCheck(item.id)}
                    className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
                      item.checked
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-300 hover:border-emerald-500 bg-white'
                    }`}
                  >
                    {item.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0">
                    <span
                      className={`text-sm font-semibold block truncate ${
                        item.checked ? 'line-through text-slate-400' : 'text-slate-800'
                      }`}
                    >
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                      {item.brand && (
                        <span className="font-medium text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded text-[11px]">
                          {item.brand}
                        </span>
                      )}
                      <span>{item.category}</span>
                      {item.estimatedPrice && (
                        <span>• ~{PriceComparisonService.formatRon(item.estimatedPrice * item.quantity)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Quantity Stepper & Unit Selector & Remove */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0 no-print">
                  {/* Quantity Stepper */}
                  <div className="flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden shadow-2xs">
                    <button
                      onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? -0.5 : -1)}
                      className="px-2 py-1 text-slate-600 hover:bg-slate-100 text-sm font-bold"
                      title="Scade cantitatea"
                    >
                      -
                    </button>
                    <span className="px-2 text-xs font-bold text-slate-800 min-w-[28px] text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleUpdateQuantity(item.id, item.unit === 'kg' ? 0.5 : 1)}
                      className="px-2 py-1 text-slate-600 hover:bg-slate-100 text-sm font-bold"
                      title="Crește cantitatea"
                    >
                      +
                    </button>
                  </div>

                  {/* Unit Selector */}
                  <select
                    value={item.unit}
                    onChange={e => handleUpdateUnit(item.id, e.target.value as UnitType)}
                    className="text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl py-1 px-1.5 focus:outline-hidden"
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
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
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

      {/* Primary Compare CTA Button */}
      {activeList.items.length > 0 && (
        <div className="sticky bottom-16 md:bottom-6 z-30 pt-2 no-print">
          <div className="bg-white/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-emerald-200 shadow-xl flex items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-500 block">Total estimat {activeList.name}</span>
              <span className="text-lg sm:text-xl font-extrabold text-slate-900">
                {PriceComparisonService.formatRon(totalEstimatedCost)}
              </span>
            </div>
            <button
              onClick={onCompare}
              className="py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Sparkles className="w-4 h-4 fill-white" />
              <span>Compară prețurile în magazine</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal: Adaugă Produs Nou Personalizat */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-900">Adaugă produs personalizat</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Produsul va fi adăugat în lista activă și va fi salvat pentru comparații.
            </p>

            <form onSubmit={handleAddCustomProduct} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Denumire produs *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="ex: Mere Ionatan, Ciocolată neagră..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Marcă (opțional)</label>
                  <input
                    type="text"
                    value={customBrand}
                    onChange={e => setCustomBrand(e.target.value)}
                    placeholder="ex: Milka, Marcă proprie"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Categorie</label>
                  <select
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
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
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Cantitate</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customQuantity}
                    onChange={e => setCustomQuantity(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Unitate</label>
                  <select
                    value={customUnit}
                    onChange={e => setCustomUnit(e.target.value as UnitType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  >
                    {UNITS.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Preț estimat (lei)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={customEstPrice}
                    onChange={e => setCustomEstPrice(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs"
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-900">Creează o listă nouă</h3>
            <p className="text-xs text-slate-500 mt-0.5">
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
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-xs"
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Ești sigur că vrei să golești lista?</h3>
            <p className="text-xs text-slate-500 mt-1">
              Toate cele {activeList.items.length} produse din „{activeList.name}” vor fi șterse.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium"
              >
                Renunță
              </button>
              <button
                onClick={handleClearList}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-xs"
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
