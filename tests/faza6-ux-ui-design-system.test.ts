// tests/faza6-ux-ui-design-system.test.ts
// Suită dedicată FAZA 6 — UX/UI DESIGN SYSTEM & RESPONSIVE EXPERIENCE
// Verifică tokenii centralizați, CSS-ul global, componentele reutilizabile StateFeedback,
// cele 6 statusuri de calitate în limba română, accesibilitatea ARIA și randarea SSR a ecranelor principale.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NODE_ENV = 'test';
process.env.COSUL_MEU_ISOLATED_TEST = '1';

import {
  DESIGN_BREAKPOINTS,
  DESIGN_CONTROL_CLASSES,
  DESIGN_SURFACE_CLASSES,
  DESIGN_TYPOGRAPHY,
  QUALITY_STATUS_DISPLAY_TOKENS,
  getQualityStatusDisplay
} from '../src/styles/designTokens.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  QualityStatusBadge
} from '../src/components/ui/StateFeedback.js';
import { Navbar } from '../src/components/Navbar.js';
import { MobileNav } from '../src/components/MobileNav.js';
import { Footer } from '../src/components/Footer.js';
import { ProductsView } from '../src/components/ProductsView.js';
import { PriceComparisonView } from '../src/components/PriceComparisonView.js';
import { ShoppingListView } from '../src/components/ShoppingListView.js';
import { BasketOptimizerPanel } from '../src/components/BasketOptimizerPanel.js';
import { ProductPriceTrend } from '../src/components/ProductPriceTrend.js';
import { PriceHistoryView } from '../src/components/PriceHistoryView.js';
import { DashboardView } from '../src/components/DashboardView.js';
import { AdminIndexQualityTab } from '../src/components/AdminIndexQualityTab.js';
import type {
  PriceAlert,
  PriceDataQualityStatus,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingList,
  Store,
  UserProfile
} from '../src/types.js';

const ROOT_DIR = process.cwd();
const noop = () => {};

const SAMPLE_STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl',
    brandColor: 'bg-blue-700',
    accentColor: 'text-blue-700',
    type: 'discounter',
    rating: 4.6,
    locationsCount: 350,
    sampleAddress: 'Bd. Timișoara 26, București'
  },
  {
    id: 'kaufland',
    name: 'Kaufland',
    slug: 'kaufland',
    chain: 'Kaufland',
    brandColor: 'bg-rose-700',
    accentColor: 'text-rose-700',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 180,
    sampleAddress: 'Șos. Colentina 6, București'
  }
];

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'prod-lapte-1l',
    name: 'Lapte UHT 3.5% Zuzu 1L',
    brand: 'Zuzu',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    baseReferencePrice: 7.49,
    barcode: '5941000012345',
    imageUrl: ''
  },
  {
    id: 'prod-paine-500g',
    name: 'Pâine integrală feliată 500g',
    brand: 'Vel Pitar',
    category: 'Panificație',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    baseReferencePrice: 6.0,
    barcode: '5941000099999',
    imageUrl: ''
  }
];

const SAMPLE_OFFERS: ProductOffer[] = [
  {
    id: 'off-lidl-lapte',
    productId: 'prod-lapte-1l',
    storeId: 'lidl',
    price: 6.49,
    currency: 'RON',
    unitPrice: 6.49,
    unitPriceMeasure: 'lei/l',
    isPromo: true,
    originalPrice: 7.49,
    verificationStatus: 'verified',
    source: 'official_feed',
    confidenceLevel: 'high',
    observationDate: '2026-11-25',
    lastChecked: '2026-11-25T10:00:00Z',
    validUntil: '2026-12-05'
  },
  {
    id: 'off-kaufland-lapte',
    productId: 'prod-lapte-1l',
    storeId: 'kaufland',
    price: 6.99,
    currency: 'RON',
    unitPrice: 6.99,
    unitPriceMeasure: 'lei/l',
    isPromo: false,
    verificationStatus: 'verified',
    source: 'official_feed',
    confidenceLevel: 'high',
    observationDate: '2026-11-25',
    lastChecked: '2026-11-25T10:00:00Z',
    validUntil: '2026-12-05'
  }
];

const SAMPLE_LIST: ShoppingList = {
  id: 'list-faza6-1',
  name: 'Cumpărături săptămânale',
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-26T08:00:00Z',
  items: [
    {
      id: 'item-1',
      productId: 'prod-lapte-1l',
      name: 'Lapte UHT 3.5% Zuzu 1L',
      category: 'Lactate și ouă',
      quantity: 2,
      unit: 'l',
      checked: false
    }
  ]
};

const SAMPLE_USER: UserProfile = {
  name: 'Andrei Popescu',
  email: 'andrei@example.ro',
  city: 'București',
  preferredStores: ['lidl', 'kaufland'],
  monthlySavingsGoal: 250,
  notificationsEnabled: true,
  defaultTransportCostEstimate: 10,
  useLoyaltyCards: true
};

const SAMPLE_OBSERVATIONS: PriceObservation[] = [
  {
    id: 'obs-1',
    productId: 'prod-lapte-1l',
    storeId: 'lidl',
    price: 6.89,
    currency: 'RON',
    date: '2026-11-10',
    source: 'official_feed'
  },
  {
    id: 'obs-2',
    productId: 'prod-lapte-1l',
    storeId: 'lidl',
    price: 6.49,
    currency: 'RON',
    date: '2026-11-25',
    source: 'verified'
  }
];

const SAMPLE_ALERTS: PriceAlert[] = [
  {
    id: 'alert-1',
    productId: 'prod-lapte-1l',
    productName: 'Lapte UHT 3.5% Zuzu 1L',
    alertType: 'below_target',
    targetPrice: 6.5,
    currentLowestPrice: 6.49,
    isActive: true,
    createdAt: '2026-11-20T10:00:00Z'
  }
];

async function runTests() {
  let passed = 0;

  // 1. index.html viewport accessibility (WCAG 1.4.4 resize text + safe-area) & lang="ro"
  {
    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf-8');
    assert.ok(indexHtml.includes('lang="ro"'), 'index.html trebuie să declare lang="ro"');
    assert.ok(
      indexHtml.includes('viewport-fit=cover'),
      'index.html trebuie să includă viewport-fit=cover pentru dispozitive cu notch'
    );
    assert.ok(
      !indexHtml.includes('user-scalable=no') && !indexHtml.includes('maximum-scale=1'),
      'index.html nu trebuie să blocheze zoom-ul pe mobil (WCAG 1.4.4)'
    );
    assert.ok(indexHtml.includes('Coșul Meu'), 'index.html trebuie să aibă titlul aplicației în română');
    passed++;
  }

  // 2. src/index.css design system tokens, focus-visible, safe-area & reduced-motion
  {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'src/index.css'), 'utf-8');
    assert.ok(css.includes('@import "tailwindcss";'), 'index.css trebuie să importe Tailwind CSS v4');
    assert.ok(css.includes('@custom-variant dark'), 'index.css trebuie să declare @custom-variant dark');
    assert.ok(css.includes('--surface-bg'), 'index.css trebuie să definească variabile CSS de suprafață');
    assert.ok(css.includes(':focus-visible'), 'index.css trebuie să definească inel de focus vizibil');
    assert.ok(css.includes('.pb-safe'), 'index.css trebuie să definească utilitarul .pb-safe');
    assert.ok(css.includes('.ds-btn'), 'index.css trebuie să definească clasele .ds-btn');
    assert.ok(css.includes('.ds-input'), 'index.css trebuie să definească clasa .ds-input');
    assert.ok(css.includes('prefers-reduced-motion'), 'index.css trebuie să respecte prefers-reduced-motion');
    assert.ok(css.includes('overflow-x: clip'), 'index.css trebuie să prevină overflow orizontal');
    passed++;
  }

  // 3. Design tokens: breakpoints 320..1440 & typography & controls
  {
    assert.equal(DESIGN_BREAKPOINTS.mobileXs, 320);
    assert.equal(DESIGN_BREAKPOINTS.mobileSm, 375);
    assert.equal(DESIGN_BREAKPOINTS.mobileMd, 390);
    assert.equal(DESIGN_BREAKPOINTS.mobileLg, 430);
    assert.equal(DESIGN_BREAKPOINTS.tablet, 768);
    assert.equal(DESIGN_BREAKPOINTS.desktop, 1024);
    assert.equal(DESIGN_BREAKPOINTS.desktopWide, 1440);
    assert.ok(DESIGN_TYPOGRAPHY.priceHero.includes('tabular-nums'));
    assert.ok(DESIGN_SURFACE_CLASSES.card.includes('surface-card'));
    assert.ok(DESIGN_CONTROL_CLASSES.btnPrimary.includes('ds-btn-primary'));
    passed++;
  }

  // 4. All 6 official quality statuses mapped deterministically in Romanian
  {
    const expectedLabels: Record<PriceDataQualityStatus, string> = {
      VERIFIED_RECENTLY: 'Verificat recent',
      VERIFIED: 'Verificat',
      STALE: 'Date învechite',
      UNVERIFIED: 'Neverificat',
      EXPIRED: 'Expirat',
      SUSPICIOUS: 'Suspect'
    };

    for (const [status, expectedLabel] of Object.entries(expectedLabels) as Array<[PriceDataQualityStatus, string]>) {
      assert.equal(QUALITY_STATUS_DISPLAY_TOKENS[status].labelRo, expectedLabel);
      assert.equal(getQualityStatusDisplay(status).labelRo, expectedLabel);

      const badgeHtml = renderToStaticMarkup(React.createElement(QualityStatusBadge, { status }));
      assert.ok(badgeHtml.includes(expectedLabel), `QualityStatusBadge(${status}) trebuie să afișeze "${expectedLabel}"`);
      assert.ok(badgeHtml.includes('aria-hidden="true"'), 'Iconița din QualityStatusBadge trebuie să fie aria-hidden');
    }

    // Fallback null-safe to UNVERIFIED
    assert.equal(getQualityStatusDisplay(null).status, 'UNVERIFIED');
    passed++;
  }

  // 5. StateFeedback reusable components: LoadingState, EmptyState, ErrorState
  {
    const loadingCard = renderToStaticMarkup(React.createElement(LoadingState, { variant: 'card', message: 'Se încarcă...' }));
    assert.ok(loadingCard.includes('role="status"') && loadingCard.includes('aria-busy="true"'));
    assert.ok(loadingCard.includes('Se încarcă...'));

    const loadingGrid = renderToStaticMarkup(React.createElement(LoadingState, { variant: 'skeleton-grid', cardsCount: 4 }));
    assert.ok(loadingGrid.includes('grid-cols-1') && loadingGrid.includes('lg:grid-cols-4'));

    const emptyHtml = renderToStaticMarkup(
      React.createElement(EmptyState, {
        title: 'Niciun produs găsit',
        description: 'Încearcă un alt filtru.',
        actionLabel: 'Resetează',
        onAction: noop
      })
    );
    assert.ok(emptyHtml.includes('Niciun produs găsit') && emptyHtml.includes('Resetează'));

    const offlineHtml = renderToStaticMarkup(
      React.createElement(ErrorState, {
        variant: 'offline',
        message: 'Conexiune offline detectată.',
        onRetry: noop,
        onDismiss: noop
      })
    );
    assert.ok(offlineHtml.includes('role="alert"') && offlineHtml.includes('Reîncearcă') && offlineHtml.includes('Închide'));
    passed++;
  }

  // 6. Navigation (Navbar + MobileNav + Footer) SSR & ARIA attributes
  {
    const navbarHtml = renderToStaticMarkup(
      React.createElement(Navbar, {
        currentTab: 'products',
        onSelectTab: noop,
        userProfile: SAMPLE_USER,
        onUpdateProfile: noop,
        alerts: SAMPLE_ALERTS,
        notifications: [],
        itemsCount: 2,
        isAuthenticated: true,
        themeMode: 'light',
        isDarkMode: false,
        onChangeTheme: noop
      })
    );
    assert.ok(navbarHtml.includes('aria-current="page"'), 'Navbar trebuie să marcheze pagina activă cu aria-current="page"');
    assert.ok(navbarHtml.includes('aria-controls="mobile-main-drawer"'), 'Butonul hamburger trebuie să aibă aria-controls');
    assert.ok(navbarHtml.includes('Coșul') && navbarHtml.includes('București'));

    const mobileNavHtml = renderToStaticMarkup(
      React.createElement(MobileNav, {
        currentTab: 'shopping-list',
        onSelectTab: noop,
        itemsCount: 3
      })
    );
    assert.ok(mobileNavHtml.includes('pb-safe'), 'MobileNav trebuie să folosească .pb-safe');
    assert.ok(mobileNavHtml.includes('aria-current="page"'), 'MobileNav trebuie să marcheze tab-ul activ');
    assert.ok(mobileNavHtml.includes('Lista mea'));

    const footerHtml = renderToStaticMarkup(
      React.createElement(Footer, {
        activeLegalRoute: null,
        onNavigateLegal: noop,
        onNavigateHome: noop,
        isAuthenticated: false
      })
    );
    assert.ok(footerHtml.includes('RON (lei)') && footerHtml.includes('Coșul'));
    passed++;
  }

  // 7. ShoppingListView + PriceComparisonView + BasketOptimizerPanel SSR & mobile-first markup
  {
    const listHtml = renderToStaticMarkup(
      React.createElement(ShoppingListView, {
        lists: [SAMPLE_LIST],
        activeList: SAMPLE_LIST,
        onUpdateLists: noop,
        onSelectActiveList: noop,
        onCompare: noop,
        catalogProducts: SAMPLE_PRODUCTS,
        catalogOffers: SAMPLE_OFFERS,
        catalogStores: SAMPLE_STORES
      })
    );
    assert.ok(listHtml.includes('Cumpărături săptămânale') && listHtml.includes('Lapte UHT 3.5% Zuzu 1L'));
    assert.ok(listHtml.includes('aria-pressed='), 'Taburile de categorie din ShoppingListView trebuie să aibă aria-pressed');

    const compareHtml = renderToStaticMarkup(
      React.createElement(PriceComparisonView, {
        activeList: SAMPLE_LIST,
        onNavigateToList: noop,
        catalogProducts: SAMPLE_PRODUCTS,
        catalogOffers: SAMPLE_OFFERS,
        catalogStores: SAMPLE_STORES
      })
    );
    assert.ok(compareHtml.includes('aria-expanded='), 'PriceComparisonView trebuie să expună aria-expanded pe detaliile magazinelor');
    assert.ok(compareHtml.includes('Lidl') && compareHtml.includes('Kaufland'), 'PriceComparisonView trebuie să randeze magazinele din catalog');
    assert.ok(compareHtml.includes('lei') || compareHtml.includes('RON'));
    const compareSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PriceComparisonView.tsx'), 'utf-8');
    assert.ok(compareSrc.includes('sm:hidden') && compareSrc.includes('hidden sm:block'), 'PriceComparisonView matrice trebuie să aibă carduri mobile < sm și tabel sm+');

    const optimizerHtml = renderToStaticMarkup(
      React.createElement(BasketOptimizerPanel, {
        lists: [SAMPLE_LIST],
        activeList: SAMPLE_LIST,
        products: SAMPLE_PRODUCTS,
        offers: SAMPLE_OFFERS,
        stores: SAMPLE_STORES
      })
    );
    assert.ok(optimizerHtml.includes('aria-pressed='), 'Controalele BasketOptimizerPanel trebuie să expună aria-pressed');
    assert.ok(optimizerHtml.includes('aria-expanded='), 'Acordeonul de limitări trebuie să expună aria-expanded');
    assert.ok(optimizerHtml.includes('sm:hidden'), 'BasketOptimizerPanel trebuie să expună layout mobil pe carduri');
    passed++;
  }

  // 8. ProductPriceTrend + PriceHistoryView + DashboardView + ProductsView + AdminIndexQualityTab SSR
  {
    const trendHtml = renderToStaticMarkup(
      React.createElement(ProductPriceTrend, {
        productId: 'prod-lapte-1l',
        productName: 'Lapte UHT 3.5% Zuzu 1L',
        product: SAMPLE_PRODUCTS[0],
        observations: SAMPLE_OBSERVATIONS,
        stores: SAMPLE_STORES
      })
    );
    assert.ok(trendHtml.includes('Istoricul prețurilor') && trendHtml.includes('RON'));
    assert.ok(trendHtml.includes('sm:hidden'), 'ProductPriceTrend trebuie să ofere carduri mobile pentru comparația între magazine');

    const historyHtml = renderToStaticMarkup(
      React.createElement(PriceHistoryView, {
        alerts: SAMPLE_ALERTS,
        trackedProductIds: ['prod-lapte-1l'],
        onUpdateAlerts: noop,
        onUpdateTrackedProductIds: noop,
        catalogProducts: SAMPLE_PRODUCTS,
        catalogOffers: SAMPLE_OFFERS,
        catalogStores: SAMPLE_STORES,
        activeList: SAMPLE_LIST
      })
    );
    assert.ok(historyHtml.includes('Alege un produs') && historyHtml.includes('Setează alertă de preț'));
    assert.ok(historyHtml.includes('max-h-[320px]'), 'Selectorul de produse pe mobil trebuie să aibă înălțime compactă');

    const dashboardHtml = renderToStaticMarkup(
      React.createElement(DashboardView, {
        userProfile: SAMPLE_USER,
        activeList: SAMPLE_LIST,
        receipts: [],
        trackedCount: 1,
        activeAlertCount: 1,
        dataSource: 'local',
        dashboardLoading: false,
        localImportCounts: { receipts: 0, lists: 0, listItems: 0, alerts: 0, trackedProducts: 0, receiptsWithImages: 0, total: 0 },
        canImportLocalData: false,
        isImportingLocalData: false,
        onImportLocalData: noop,
        onNavigate: noop,
        onOpenReceipt: noop,
        catalogProducts: SAMPLE_PRODUCTS,
        catalogOffers: SAMPLE_OFFERS,
        catalogStores: SAMPLE_STORES
      })
    );
    assert.ok(dashboardHtml.includes('Catalog Produse') && dashboardHtml.includes('Compară coșul'));

    const productsViewHtml = renderToStaticMarkup(
      React.createElement(ProductsView, {
        onSelectProduct: noop,
        activeList: SAMPLE_LIST
      })
    );
    assert.ok(productsViewHtml.includes('Paginare catalog') || productsViewHtml.includes('Catalog Produse') || productsViewHtml.includes('Caută'));

    const adminQualityHtml = renderToStaticMarkup(
      React.createElement(AdminIndexQualityTab, {
        adminToken: 'test-token'
      })
    );
    assert.ok(adminQualityHtml.includes('role="tablist"'), 'AdminIndexQualityTab trebuie să folosească role="tablist"');
    assert.ok(adminQualityHtml.includes('Rulează verificare'), 'AdminIndexQualityTab trebuie să randeze controlul de verificare');
    passed++;
  }

  console.log(`✅ FAZA 6 UX/UI Design System: ${passed}/8 grupuri de verificare trecute cu succes!`);
}

runTests().catch(err => {
  console.error('❌ Eroare test FAZA 6:', err);
  process.exit(1);
});
