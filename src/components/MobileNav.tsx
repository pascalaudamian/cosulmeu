import React from 'react';
import { Home, ListOrdered, ReceiptText, User, ShoppingBag } from 'lucide-react';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onPrefetchTab?: (tab: string) => void;
  itemsCount: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  currentTab,
  onSelectTab,
  onPrefetchTab,
  itemsCount
}) => {
  const navItems = [
    {
      id: 'dashboard',
      label: 'Acasă',
      ariaLabel: 'Mergi la Acasă',
      icon: Home,
      isActive: currentTab === 'dashboard'
    },
    {
      id: 'products',
      label: 'Produse',
      ariaLabel: 'Mergi la Produse',
      icon: ShoppingBag,
      isActive: currentTab === 'products' || currentTab === 'product-detail'
    },
    {
      id: 'shopping-list',
      label: 'Lista mea',
      ariaLabel: `Lista mea: ${itemsCount} produse`,
      icon: ListOrdered,
      isActive: currentTab === 'shopping-list',
      badge: itemsCount > 0 ? itemsCount : undefined
    },
    {
      id: 'receipts',
      label: 'Bonuri',
      ariaLabel: 'Mergi la Bonuri',
      icon: ReceiptText,
      isActive: currentTab === 'receipts' || currentTab === 'scan-receipt'
    },
    {
      id: 'profile',
      label: 'Cont',
      ariaLabel: 'Mergi la Contul meu',
      icon: User,
      isActive: currentTab === 'profile' || currentTab === 'auth'
    }
  ];

  return (
    <nav
      aria-label="Navigație mobilă rapidă"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/90 px-2 py-1 pb-safe no-print"
    >
      <div className="grid grid-cols-5 gap-1 items-center max-w-md mx-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              onTouchStart={() => onPrefetchTab?.(item.id)}
              onFocus={() => onPrefetchTab?.(item.id)}
              className={`min-h-[48px] relative flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
                item.isActive
                  ? 'text-emerald-700 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 font-medium'
              }`}
              aria-label={item.ariaLabel}
              aria-current={item.isActive ? 'page' : undefined}
            >
              {item.isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-emerald-600" aria-hidden="true" />
              )}
              <div className="relative">
                <Icon className={`w-5 h-5 ${item.isActive ? 'stroke-[2.2] text-emerald-600' : 'stroke-[1.75]'}`} />
                {item.badge !== undefined && (
                  <span className="absolute -top-1.5 -right-2 bg-emerald-600 text-white text-[9px] font-bold px-1 min-w-[15px] h-[15px] flex items-center justify-center rounded-full tabular-nums">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
