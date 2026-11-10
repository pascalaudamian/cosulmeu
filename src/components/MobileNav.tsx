import React from 'react';
import { Home, ListOrdered, ReceiptText, User, ShoppingBag } from 'lucide-react';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  itemsCount: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab, itemsCount }) => {
  return (
    <nav
      aria-label="Navigație mobilă rapidă"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] px-2 py-1 pb-safe no-print"
    >
      <div className="grid grid-cols-5 gap-1 items-center max-w-md mx-auto">
        {/* 1. Acasă */}
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
            currentTab === 'dashboard'
              ? 'text-emerald-700 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
          aria-label="Mergi la Acasă"
        >
          <Home className={`w-5 h-5 ${currentTab === 'dashboard' ? 'stroke-[2.4] text-emerald-600' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Acasă</span>
        </button>

        {/* 2. Produse */}
        <button
          type="button"
          onClick={() => onSelectTab('products')}
          className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
            currentTab === 'products' || currentTab === 'product-detail'
              ? 'text-emerald-700 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
          aria-label="Mergi la Produse"
        >
          <ShoppingBag className={`w-5 h-5 ${currentTab === 'products' || currentTab === 'product-detail' ? 'stroke-[2.4] text-emerald-600' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Produse</span>
        </button>

        {/* 3. Lista mea cu discrete badge */}
        <button
          type="button"
          onClick={() => onSelectTab('shopping-list')}
          className={`min-h-[48px] relative flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
            currentTab === 'shopping-list'
              ? 'text-emerald-700 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
          aria-label={`Lista mea: ${itemsCount} produse`}
        >
          <div className="relative">
            <ListOrdered className={`w-5 h-5 ${currentTab === 'shopping-list' ? 'stroke-[2.4] text-emerald-600' : 'stroke-[1.8]'}`} />
            {itemsCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-emerald-600 text-white text-[9px] font-bold px-1 min-w-[15px] h-[15px] flex items-center justify-center rounded-full shadow-xs">
                {itemsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Lista mea</span>
        </button>

        {/* 4. Bonuri */}
        <button
          type="button"
          onClick={() => onSelectTab('receipts')}
          className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
            currentTab === 'receipts' || currentTab === 'scan-receipt'
              ? 'text-emerald-700 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
          aria-label="Mergi la Bonuri"
        >
          <ReceiptText className={`w-5 h-5 ${currentTab === 'receipts' || currentTab === 'scan-receipt' ? 'stroke-[2.4] text-emerald-600' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Bonuri</span>
        </button>

        {/* 5. Contul meu */}
        <button
          type="button"
          onClick={() => onSelectTab('profile')}
          className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
            currentTab === 'profile' || currentTab === 'auth'
              ? 'text-emerald-700 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
          aria-label="Mergi la Contul meu"
        >
          <User className={`w-5 h-5 ${currentTab === 'profile' || currentTab === 'auth' ? 'stroke-[2.4] text-emerald-600' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Contul meu</span>
        </button>
      </div>
    </nav>
  );
};
