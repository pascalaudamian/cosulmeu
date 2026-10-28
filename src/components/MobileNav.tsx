import React from 'react';
import { Home, ListOrdered, Sparkles, ReceiptText, User } from 'lucide-react';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  itemsCount: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab, itemsCount }) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg px-2 py-1 safe-area-pb no-print">
      <div className="grid grid-cols-5 gap-1 items-center">
        {/* Acasă */}
        <button
          onClick={() => onSelectTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
            currentTab === 'dashboard'
              ? 'text-emerald-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <Home className={`w-5 h-5 ${currentTab === 'dashboard' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Acasă</span>
        </button>

        {/* Lista mea */}
        <button
          onClick={() => onSelectTab('shopping-list')}
          className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
            currentTab === 'shopping-list'
              ? 'text-emerald-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <div className="relative">
            <ListOrdered className={`w-5 h-5 ${currentTab === 'shopping-list' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
            {itemsCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-emerald-600 text-white text-[9px] font-bold px-1 min-w-[15px] h-[15px] flex items-center justify-center rounded-full">
                {itemsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Lista mea</span>
        </button>

        {/* Compară */}
        <button
          onClick={() => onSelectTab('compare')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
            currentTab === 'compare'
              ? 'text-emerald-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-500/30 -mt-2">
            <Sparkles className="w-4 h-4 fill-white" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Compară</span>
        </button>

        {/* Bonuri */}
        <button
          onClick={() => onSelectTab('scan-receipt')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
            currentTab === 'scan-receipt' || currentTab === 'receipts'
              ? 'text-emerald-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <ReceiptText className={`w-5 h-5 ${currentTab === 'scan-receipt' || currentTab === 'receipts' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Bonuri</span>
        </button>

        {/* Profil */}
        <button
          onClick={() => onSelectTab('profile')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
            currentTab === 'profile'
              ? 'text-emerald-600 font-bold'
              : 'text-slate-500 hover:text-slate-900 font-medium'
          }`}
        >
          <User className={`w-5 h-5 ${currentTab === 'profile' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight">Profil</span>
        </button>
      </div>
    </nav>
  );
};
