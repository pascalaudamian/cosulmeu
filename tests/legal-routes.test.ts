import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  isManualPlaceholder,
  LEGAL_CONFIG,
  LEGAL_ROUTE_MAP,
  LEGAL_ROUTES,
  normalizePathname,
  resolveLegalRouteFromPath
} from '../src/config/legalConfig.js';
import { Footer } from '../src/components/Footer.js';
import { LegalPagesView } from '../src/components/LegalPagesView.js';
import { Navbar } from '../src/components/Navbar.js';
import { MobileNav } from '../src/components/MobileNav.js';
import type { UserProfile } from '../src/types.js';

console.log('🧪 Rulare teste pentru rutele juridice și configurația de operator persoană fizică...');

// 1. Verifică existența exactă a celor 7 rute cerute
const expectedPaths = [
  '/despre',
  '/contact',
  '/termeni-si-conditii',
  '/disclaimer-preturi',
  '/proprietate-intelectuala',
  '/politica-de-confidentialitate',
  '/politica-cookies'
] as const;

assert.equal(LEGAL_ROUTES.length, 7, 'Trebuie să existe exact 7 rute juridice/informative');
for (const path of expectedPaths) {
  assert.ok(LEGAL_ROUTE_MAP[path], `Ruta ${path} trebuie să fie definită`);
  assert.equal(resolveLegalRouteFromPath(path), path, `resolveLegalRouteFromPath("${path}") trebuie să recunoască ruta`);
  assert.equal(resolveLegalRouteFromPath(`${path}/`), path, `resolveLegalRouteFromPath("${path}/") trebuie să normalizeze trailing slash`);
}

// 2. Verifică rutele inexistente / homepage
assert.equal(normalizePathname('/'), '/');
assert.equal(normalizePathname('/despre/'), '/despre');
assert.equal(resolveLegalRouteFromPath('/'), null);
assert.equal(resolveLegalRouteFromPath('/produse'), null);
assert.equal(resolveLegalRouteFromPath('/api/health'), null);

// 3. Verifică gruparea pe cele 3 secțiuni de footer
const sections = {
  'cosul-meu': LEGAL_ROUTES.filter(r => r.section === 'cosul-meu').map(r => r.path),
  informatii: LEGAL_ROUTES.filter(r => r.section === 'informatii').map(r => r.path),
  confidentialitate: LEGAL_ROUTES.filter(r => r.section === 'confidentialitate').map(r => r.path)
};
assert.deepEqual(sections['cosul-meu'], ['/despre', '/contact']);
assert.deepEqual(sections.informatii, [
  '/termeni-si-conditii',
  '/disclaimer-preturi',
  '/proprietate-intelectuala'
]);
assert.deepEqual(sections.confidentialitate, [
  '/politica-de-confidentialitate',
  '/politica-cookies'
]);

// 4. Verifică structura operatorului persoană fizică
assert.equal(LEGAL_CONFIG.operator.operatorType, 'individual');
assert.equal(LEGAL_CONFIG.operator.country, 'România');
assert.equal(LEGAL_CONFIG.operator.website, 'https://cosulmeu.vercel.app/');
assert.ok(LEGAL_CONFIG.operator.activityDescription.length > 0);
assert.ok(LEGAL_CONFIG.operator.businessRegistrationStatus.includes('persoană fizică'));

// 5. Verifică marcajele configurabile (fără date inventate)
const manualFields = [
  LEGAL_CONFIG.lastUpdated,
  LEGAL_CONFIG.operator.fullName,
  LEGAL_CONFIG.operator.contactEmail,
  LEGAL_CONFIG.operator.contactPhone,
  LEGAL_CONFIG.contact.privacyEmail,
  LEGAL_CONFIG.contact.ipEmail,
  LEGAL_CONFIG.contact.supportHours,
  LEGAL_CONFIG.terms.complaintsResponseTime,
  LEGAL_CONFIG.terms.disputeResolutionNote,
  LEGAL_CONFIG.terms.applicableLawNote,
  LEGAL_CONFIG.privacy.accountDataRetention,
  LEGAL_CONFIG.privacy.receiptsDataRetention,
  LEGAL_CONFIG.privacy.technicalLogsRetention,
  LEGAL_CONFIG.privacy.processorsAndRegionsNote,
  LEGAL_CONFIG.privacy.internationalTransfersNote,
  LEGAL_CONFIG.ip.noticeReviewTerm
];

for (const field of manualFields) {
  assert.ok(
    isManualPlaceholder(field),
    `Câmpul "${field}" trebuie să rămână marcaj explicit [De completat...] până la completarea manuală`
  );
}

// 6. Verifică randarea Footer-ului
const noop = () => {};
const footerHtml = renderToStaticMarkup(
  React.createElement(Footer, {
    activeLegalRoute: null,
    onNavigateLegal: noop,
    onNavigateHome: noop,
    onOpenCookieSettings: noop,
    isAuthenticated: false
  })
);

assert.ok(footerHtml.includes('<footer'), 'Footer trebuie să randeze element semantic <footer>');
assert.ok(!footerHtml.includes(' fixed ') && !footerHtml.includes(' sticky '), 'Footer nu trebuie să fie fixed sau sticky');
assert.ok(footerHtml.includes('Coșul Meu'), 'Footer trebuie să conțină secțiunea Coșul Meu');
assert.ok(footerHtml.includes('Informații'), 'Footer trebuie să conțină secțiunea Informații');
assert.ok(footerHtml.includes('Confidențialitate'), 'Footer trebuie să conțină secțiunea Confidențialitate');
assert.ok(footerHtml.includes('Setări cookie-uri'), 'Footer trebuie să includă butonul permanent Setări cookie-uri');

const currentYear = new Date().getFullYear();
assert.ok(
  footerHtml.includes(`© ${currentYear} Coșul Meu. Toate drepturile rezervate.`),
  'Footer trebuie să conțină copyright-ul cu anul curent dinamic'
);

for (const route of LEGAL_ROUTES) {
  assert.ok(footerHtml.includes(`href="${route.path}"`), `Footer trebuie să conțină link către ${route.path}`);
  assert.ok(footerHtml.includes(route.label), `Footer trebuie să conțină eticheta ${route.label}`);
}

// 7. Verifică că Navbar și MobileNav NU conțin linkurile juridice
const mockProfile: UserProfile = {
  id: 'guest',
  name: 'Vizitator',
  email: '',
  city: 'București',
  monthlySavingsGoal: 350,
  notificationsEnabled: false,
  preferredStores: ['lidl', 'kaufland'],
  defaultTransportCostEstimate: 12,
  useLoyaltyCards: true
};

const navbarHtml = renderToStaticMarkup(
  React.createElement(Navbar, {
    currentTab: 'dashboard',
    onSelectTab: noop,
    userProfile: mockProfile,
    onUpdateProfile: noop,
    alerts: [],
    itemsCount: 0
  })
);
const mobileNavHtml = renderToStaticMarkup(
  React.createElement(MobileNav, {
    currentTab: 'dashboard',
    onSelectTab: noop,
    itemsCount: 0
  })
);

for (const route of LEGAL_ROUTES) {
  assert.ok(!navbarHtml.includes(route.path), `Navbar nu trebuie să conțină ruta juridică ${route.path}`);
  assert.ok(!navbarHtml.includes(route.label), `Navbar nu trebuie să conțină linkul juridic ${route.label}`);
  assert.ok(!mobileNavHtml.includes(route.path), `MobileNav nu trebuie să conțină ruta juridică ${route.path}`);
}

// 8. Verifică randarea și conformitatea fiecăreia dintre cele 7 pagini juridice
const forbiddenCompanyPatterns = [
  /\bCUI\b/i,
  /\bCIF\b/i,
  /Registrul Comerțului/i,
  /Sediu social/i,
  /\bS\.?R\.?L\.?\b/i,
  /\bP\.?F\.?A\.?\b/i
];

for (const route of LEGAL_ROUTES) {
  const pageHtml = renderToStaticMarkup(
    React.createElement(LegalPagesView, {
      route: route.path,
      onNavigateHome: noop,
      onNavigateLegal: noop,
      onOpenCookieSettings: noop
    })
  );

  assert.ok(pageHtml.includes('<h1'), `Pagina ${route.path} trebuie să conțină un titlu <h1>`);
  assert.ok(pageHtml.includes(route.title), `Pagina ${route.path} trebuie să afișeze titlul ${route.title}`);
  assert.ok(pageHtml.includes('Data ultimei actualizări'), `Pagina ${route.path} trebuie să includă data ultimei actualizări`);
  assert.ok(pageHtml.includes('href="/"'), `Pagina ${route.path} trebuie să includă link de întoarcere către /`);
  assert.ok(pageHtml.includes('Înapoi la pagina principală'), `Pagina ${route.path} trebuie să includă textul Înapoi la pagina principală`);
  assert.ok(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(pageHtml), `Pagina ${route.path} nu trebuie să conțină adrese de email inventate`);
  assert.ok(!/nu își asumă nicio răspundere/i.test(pageHtml), `Pagina ${route.path} nu trebuie să excludă complet orice răspundere legală`);

  for (const pattern of forbiddenCompanyPatterns) {
    assert.ok(
      !pattern.test(pageHtml),
      `Pagina ${route.path} nu trebuie să menționeze date de firmă inexistente (${pattern})`
    );
  }
}

// 9. Verificări specifice de conținut tehnic real pe paginile cheie
const privacyHtml = renderToStaticMarkup(
  React.createElement(LegalPagesView, {
    route: '/politica-de-confidentialitate',
    onNavigateHome: noop,
    onNavigateLegal: noop,
    onOpenCookieSettings: noop
  })
);
assert.ok(privacyHtml.includes('Supabase'), 'Politica de confidențialitate trebuie să menționeze Supabase');
assert.ok(privacyHtml.includes('Vercel'), 'Politica de confidențialitate trebuie să menționeze Vercel');
assert.ok(privacyHtml.includes('receipt-images'), 'Politica de confidențialitate trebuie să menționeze bucket-ul receipt-images');
assert.ok(privacyHtml.includes('ANSPDCP'), 'Politica de confidențialitate trebuie să menționeze ANSPDCP');
assert.ok(privacyHtml.includes('Art. 6 alin. (1)'), 'Politica de confidențialitate trebuie să detalieze temeiurile juridice per scop');

const cookiesHtml = renderToStaticMarkup(
  React.createElement(LegalPagesView, {
    route: '/politica-cookies',
    onNavigateHome: noop,
    onNavigateLegal: noop,
    onOpenCookieSettings: noop
  })
);
assert.ok(cookiesHtml.includes('localStorage'), 'Politica cookies trebuie să menționeze localStorage');
assert.ok(cookiesHtml.includes('sessionStorage'), 'Politica cookies trebuie să menționeze sessionStorage');
assert.ok(
  cookiesHtml.includes('mecanism activ de gestionare a consimțământului'),
  'Politica cookies trebuie să reflecte mecanismul activ de consimțământ implementat'
);

console.log('✅ Toate verificările pentru operator persoană fizică, conformitate, footer și pagini au trecut!');
