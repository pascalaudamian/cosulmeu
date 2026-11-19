import React from 'react';
import { X, Split } from 'lucide-react';
import { ShoppingList, ShoppingListItem, Product, ProductOffer, Store as StoreType } from '../types.js';
import { BasketOptimizerPanel } from './BasketOptimizerPanel.js';

interface MultiStoreOptimizationModalProps {
  items: ShoppingListItem[];
  listName?: string;
  onClose: () => void;
  products?: Product[];
  offers?: ProductOffer[];
  stores?: StoreType[];
}

export const MultiStoreOptimizationModal: React.FC<MultiStoreOptimizationModalProps> = ({
  items,
  listName = 'Lista mea activă',
  onClose,
  products,
  offers,
  stores
}) => {
  const virtualList: ShoppingList = {
    id: 'modal-active-list',
    name: listName,
    items,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-8 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Split className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Optimizează coșul între magazine
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Strategie transparentă bazată exclusiv pe oferte valide din catalog
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide fereastra"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <BasketOptimizerPanel
          activeList={virtualList}
          onBackToList={onClose}
          products={products}
          offers={offers}
          stores={stores}
          initialTransportCost={0}
        />
      </div>
    </div>
  );
};
