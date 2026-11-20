import type { CookieConsentCategory } from '../types.js';

export type LegalRoutePath =
  | '/despre'
  | '/contact'
  | '/termeni-si-conditii'
  | '/disclaimer-preturi'
  | '/proprietate-intelectuala'
  | '/politica-de-confidentialitate'
  | '/politica-cookies';

export interface LegalRouteMeta {
  path: LegalRoutePath;
  label: string;
  title: string;
  section: 'cosul-meu' | 'informatii' | 'confidentialitate';
  summary: string;
}

export const PRIVACY_POLICY_VERSION = '2026-04-gdpr-v2';
export const COOKIE_POLICY_VERSION = '2026-04-cookies-v2';
export const COOKIE_BANNER_VERSION = '2026-04-banner-v1';
export const MARKETING_CONSENT_TEXT_VERSION = '2026-04-comm-v1';

export const CONSENT_STORAGE_KEY = 'cosul_meu_cookie_consent_v1';
export const VISITOR_PSEUDONYM_KEY = 'cosul_meu_visitor_session_id';

export const LEGAL_ROUTES: LegalRouteMeta[] = [
  {
    path: '/despre',
    label: 'Despre Coșul Meu',
    title: 'Despre Coșul Meu',
    section: 'cosul-meu',
    summary:
      'Scopul proiectului, funcționalitățile platformei și caracterul independent al comparațiilor de prețuri.'
  },
  {
    path: '/contact',
    label: 'Contact',
    title: 'Contact și sesizări',
    section: 'cosul-meu',
    summary:
      'Canalul de contact al operatorului persoană fizică pentru sesizări, erori de preț, reclamații și solicitări legale.'
  },
  {
    path: '/termeni-si-conditii',
    label: 'Termeni și condiții',
    title: 'Termeni și condiții',
    section: 'informatii',
    summary:
      'Condițiile de utilizare a platformei Coșul Meu, administrată de o persoană fizică, și obligațiile aplicabile.'
  },
  {
    path: '/disclaimer-preturi',
    label: 'Disclaimer privind prețurile și ofertele',
    title: 'Disclaimer privind prețurile și ofertele',
    section: 'informatii',
    summary:
      'Caracterul orientativ al prețurilor afișate, sursele de date și necesitatea confirmării prețului final la comerciant.'
  },
  {
    path: '/proprietate-intelectuala',
    label: 'Proprietate intelectuală',
    title: 'Proprietate intelectuală',
    section: 'informatii',
    summary:
      'Drepturile asupra platformei proprii, utilizarea mărcilor terților și procedura de notificare și verificare.'
  },
  {
    path: '/politica-de-confidentialitate',
    label: 'Politica de confidențialitate',
    title: 'Politica de confidențialitate',
    section: 'confidentialitate',
    summary:
      'Prelucrarea datelor personale în Coșul Meu, temeiurile juridice, infrastructura utilizată, retenția și drepturile GDPR.'
  },
  {
    path: '/politica-cookies',
    label: 'Politica cookies',
    title: 'Politica cookies',
    section: 'confidentialitate',
    summary:
      'Cookie-urile, mecanismele de stocare locală, scripturile externe și gestionarea consimțământului.'
  }
];

export const LEGAL_ROUTE_MAP: Record<LegalRoutePath, LegalRouteMeta> = LEGAL_ROUTES.reduce(
  (acc, item) => {
    acc[item.path] = item;
    return acc;
  },
  {} as Record<LegalRoutePath, LegalRouteMeta>
);

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

export function resolveLegalRouteFromPath(pathname: string): LegalRoutePath | null {
  const normalized = normalizePathname(pathname);
  return Object.prototype.hasOwnProperty.call(LEGAL_ROUTE_MAP, normalized)
    ? (normalized as LegalRoutePath)
    : null;
}

export interface GdprProcessingPurposeEntry {
  id: string;
  purpose: string;
  dataCategories: string;
  legalBasis: string;
  gdprArticle: string;
  retention: string;
  recipients: string;
}

export interface TechnicalProviderEntry {
  id: string;
  name: string;
  role: string;
  dataProcessed: string;
  regionStatus: string;
  transferSafeguards: string;
  activelyUsed: boolean;
}

export interface CookieCategoryDefinition {
  id: CookieConsentCategory;
  name: string;
  required: boolean;
  defaultEnabled: boolean;
  installedInApp: boolean;
  description: string;
  purpose: string;
  retention: string;
  provider: string;
}

export interface DetectedStorageOrCookieEntry {
  name: string;
  mechanism: 'localStorage' | 'sessionStorage' | 'HTTP Cookie' | 'External Request';
  category: CookieConsentCategory;
  provider: string;
  purpose: string;
  duration: string;
  installedInApp: boolean;
  notes: string;
}

/**
 * Matricea scopurilor de prelucrare conform auditului real al aplicației Coșul Meu.
 * Nu atribuie toate prelucrările consimțământului — fiecare scop are temeiul juridic propriu.
 */
export const GDPR_PROCESSING_MATRIX: GdprProcessingPurposeEntry[] = [
  {
    id: 'account_auth',
    purpose: 'Creare cont, autentificare și administrarea sesiunii de acces',
    dataCategories: 'ID utilizator, email, parolă criptată/hash-uită (gestionată de Supabase Auth), nume/prenume sau nume afișat, oraș preferat',
    legalBasis: 'Executarea serviciului / contractului solicitat de utilizator',
    gdprArticle: 'Art. 6 alin. (1) lit. b) GDPR',
    retention: 'Pe durata existenței contului; după ștergerea contului: [De completat și validat juridic]',
    recipients: 'Supabase (autentificare și bază de date), Vercel (găzduire web)'
  },
  {
    id: 'lists_preferences',
    purpose: 'Păstrare liste de cumpărături, produse urmărite, alerte și preferințe (oraș, magazine, temă, carduri fidelitate)',
    dataCategories: 'ID utilizator, liste și articole salvate, oraș, magazine preferate, preferință temă, praguri de preț',
    legalBasis: 'Executarea serviciului / funcționalității solicitate de utilizator',
    gdprArticle: 'Art. 6 alin. (1) lit. b) GDPR',
    retention: 'Până la ștergerea de către utilizator sau ștergerea contului',
    recipients: 'Supabase (PostgreSQL cu Row Level Security)'
  },
  {
    id: 'receipts_ocr',
    purpose: 'Scanare bonuri fiscale (OCR), extragere articole și istoric personal de prețuri',
    dataCategories: 'Imagini bonuri încărcate în bucket-ul privat receipt-images, nume comerciant, dată, produse, cantități, prețuri, observații personale',
    legalBasis: 'Executarea funcționalității inițiate explicit de utilizator la încărcarea bonului',
    gdprArticle: 'Art. 6 alin. (1) lit. b) GDPR',
    retention: 'Până la ștergerea bonului de către utilizator sau ștergerea contului; [De confirmat retenția automată]',
    recipients: 'Supabase Storage (privat, acces prin URL semnat temporar), Google Gemini API (procesare OCR pe server dacă GEMINI_API_KEY este configurat)'
  },
  {
    id: 'user_support_contact',
    purpose: 'Comunicări de suport, sesizări erori de preț și exercitarea drepturilor GDPR',
    dataCategories: 'Email, eventual nume/prenume/telefon furnizate voluntar, detalii solicitare, istoric status solicitare GDPR',
    legalBasis: 'Obligație legală (art. 12–22 GDPR pentru cereri GDPR) și/sau interes legitim / demersuri la cererea utilizatorului',
    gdprArticle: 'Art. 6 alin. (1) lit. c) și lit. f) GDPR',
    retention: '[De completat și validat juridic: ex. durata necesară soluționării și evidenței conformității GDPR]',
    recipients: 'Operatorul persoană fizică, Supabase (tabel gdpr_requests și evidență tehnică anonimizată)'
  },
  {
    id: 'security_antiabuse',
    purpose: 'Securitate informatică, protecție anti-abuz, rate limiting și prevenire acces neautorizat',
    dataCategories: 'Adresă IP (procesată tranzitoriu pentru limitarea cererilor/autentificare), jurnale tehnice HTTP, identificatori tehnici de sesiune',
    legalBasis: 'Interes legitim în securitatea și integritatea platformei',
    gdprArticle: 'Art. 6 alin. (1) lit. f) GDPR',
    retention: '[De completat: perioada de retenție configurată în jurnalele Vercel / server]',
    recipients: 'Vercel (infrastructură hosting), Supabase (jurnale auth/DB)'
  },
  {
    id: 'marketing_optional_comms',
    purpose: 'Comunicări opționale sau newsletter/promoții (exclusiv dacă utilizatorul își dă acordul separat)',
    dataCategories: 'Email, preferință canal comunicare, timestamp și versiune text consimțământ',
    legalBasis: 'Consimțământ expres și separat, revocabil oricând fără a afecta contul',
    gdprArticle: 'Art. 6 alin. (1) lit. a) GDPR',
    retention: 'Până la retragerea consimțământului; dovada acordării/retragerii se păstrează strict cât este necesar justificării conformității',
    recipients: 'Operatorul persoană fizică, Supabase (tabel communication_consents)'
  },
  {
    id: 'cookies_consent_proof',
    purpose: 'Evidența acordării, refuzului sau retragerii consimțământului pentru cookie-uri',
    dataCategories: 'Identificator pseudonimizat de vizitator (visitor_session_id), ID utilizator (dacă este autentificat), categorii alese, versiune politică, timestamp',
    legalBasis: 'Obligație legală / demonstrarea conformității privind consimțământul (ePrivacy & GDPR)',
    gdprArticle: 'Art. 6 alin. (1) lit. c) și lit. f) GDPR',
    retention: '[De completat și validat juridic: durata de păstrare a dovezii consimțământului]',
    recipients: 'Supabase (tabel cookie_consents) și stocare locală în browser'
  }
];

export const TECHNICAL_PROVIDERS_CONFIG: TechnicalProviderEntry[] = [
  {
    id: 'supabase',
    name: 'Supabase (Auth, PostgreSQL cu RLS, Storage)',
    role: 'Autentificare utilizatori, stocare baze de date și fișiere private (bonuri/avataruri)',
    dataProcessed: 'Conturi, preferințe, liste, alerte, bonuri fiscale, imagini bonuri, solicitări GDPR, evidențe consimțământ',
    regionStatus: '[De completat cu regiunea reală selectată în proiectul Supabase, ex. EU West / Frankfurt sau altă regiune]',
    transferSafeguards: '[De verificat în panoul Supabase și DPA Supabase — ex. SCC dacă există acces/subprocesatori în afara SEE]',
    activelyUsed: true
  },
  {
    id: 'vercel',
    name: 'Vercel',
    role: 'Găzduire aplicație web și execuție rute API server-side',
    dataProcessed: 'Cereri HTTP, metadate tehnice necesare rutării și securității, jurnale de execuție',
    regionStatus: '[De completat cu regiunea Vercel Functions / Edge configurată în proiect]',
    transferSafeguards: '[De verificat DPA Vercel și Clauzele Contractuale Standard (SCC) dacă traficul tranzitează SUA/alte regiuni]',
    activelyUsed: true
  },
  {
    id: 'gemini_ocr',
    name: 'Google Gemini API (@google/genai)',
    role: 'Extragere OCR structurată a articolelor de pe imaginile bonurilor fiscale încărcate de utilizator',
    dataProcessed: 'Imaginea bonului transmisă exclusiv în momentul în care utilizatorul declanșează scanarea bonului',
    regionStatus: '[De verificat configurarea regiunii / termenilor Google Gemini API utilizați]',
    transferSafeguards: '[De verificat DPA / termenii API Google aplicabili pentru prelucrarea imaginilor OCR]',
    activelyUsed: true
  },
  {
    id: 'google_fonts',
    name: 'Google Fonts (fonts.googleapis.com / fonts.gstatic.com)',
    role: 'Încărcare fonturi tipografice (Outfit, Plus Jakarta Sans) în pagina web',
    dataProcessed: 'Cerere HTTP a browserului către CDN-ul Google Fonts (adresă IP și User-Agent transmise tehnic la descărcarea fontului)',
    regionStatus: 'Serviciu distribuit global (CDN Google)',
    transferSafeguards: '[De evaluat dacă se dorește găzduirea locală (self-hosting) a fonturilor pentru eliminarea conexiunilor externe către Google]',
    activelyUsed: true
  }
];

export const COOKIE_CATEGORIES_CONFIG: CookieCategoryDefinition[] = [
  {
    id: 'necessary',
    name: 'Strict necesare',
    required: true,
    defaultEnabled: true,
    installedInApp: true,
    description: 'Esențiale pentru funcționarea de bază a aplicației, autentificare, securitate și memorarea alegerii tale privind cookie-urile.',
    purpose: 'Menținerea sesiunii de autentificare, protecție securitate și salvarea preferinței de consimțământ.',
    retention: 'Sesiune sau până la deconectare / expirarea sesiunii de autentificare.',
    provider: 'Coșul Meu / Supabase Auth'
  },
  {
    id: 'preferences',
    name: 'Preferințe',
    required: false,
    defaultEnabled: false,
    installedInApp: true,
    description: 'Memorează setări opționale de confort în interfață (cum ar fi tema vizuală Light/Dark când nu ești autentificat).',
    purpose: 'Păstrarea aspectului vizual ales între vizite.',
    retention: 'Persistent în localStorage până la ștergerea din browser sau retragerea preferinței.',
    provider: 'Coșul Meu (local în browser)'
  },
  {
    id: 'analytics',
    name: 'Analiză și statistici',
    required: false,
    defaultEnabled: false,
    installedInApp: false,
    description: 'Ar măsura anonim modul de utilizare a paginilor. În versiunea actuală NU sunt instalate scripturi de analiză (nu folosim Google Analytics, Plausible sau PostHog).',
    purpose: 'Neutilizat în prezent în aplicație. Activarea acestui comutator nu încarcă niciun tracker extern.',
    retention: 'Nu se aplică (0 scripturi active).',
    provider: 'Niciun furnizor activ în prezent'
  },
  {
    id: 'marketing',
    name: 'Marketing',
    required: false,
    defaultEnabled: false,
    installedInApp: false,
    description: 'Ar servi pentru personalizare publicitară sau pixeli terți. Aplicația NU conține scripturi de marketing, pixeli de urmărire sau rețele de publicitate.',
    purpose: 'Neutilizat în prezent în aplicație. Activarea acestui comutator nu încarcă niciun script de marketing.',
    retention: 'Nu se aplică (0 scripturi active).',
    provider: 'Niciun furnizor activ în prezent'
  }
];

export const DETECTED_COOKIES_AND_STORAGE: DetectedStorageOrCookieEntry[] = [
  {
    name: 'cosul_meu_cookie_consent_v1',
    mechanism: 'localStorage',
    category: 'necessary',
    provider: 'Coșul Meu',
    purpose: 'Memorează alegerea ta privind categoriile de cookie-uri și versiunea politicii acceptate/respinse.',
    duration: 'Persistent până la ștergerea din browser sau schimbarea versiunii politicii',
    installedInApp: true,
    notes: 'Strict necesar pentru a respecta alegerea ta și a nu afișa bannerul la fiecare pagină.'
  },
  {
    name: 'cosul_meu_visitor_session_id',
    mechanism: 'localStorage',
    category: 'necessary',
    provider: 'Coșul Meu',
    purpose: 'Identificator aleatoriu pseudonimizat pentru corelarea dovezii de consimțământ cookie înainte de autentificare.',
    duration: 'Persistent până la ștergerea datelor browserului',
    installedInApp: true,
    notes: 'Nu este utilizat pentru urmărire publicitară sau profilare.'
  },
  {
    name: 'sb-*-auth-token (Supabase Auth)',
    mechanism: 'localStorage',
    category: 'necessary',
    provider: 'Supabase',
    purpose: 'Păstrează tokenul de sesiune pentru utilizatorii autentificați.',
    duration: 'Până la deconectare (Sign Out) sau expirarea tokenului de sesiune',
    installedInApp: true,
    notes: 'Necesar exclusiv dacă utilizatorul alege să se autentifice în cont.'
  },
  {
    name: 'sessionCookie (opțional pe rute API interne)',
    mechanism: 'HTTP Cookie',
    category: 'necessary',
    provider: 'Coșul Meu (Backend API)',
    purpose: 'Cookie HttpOnly, SameSite=Lax folosit exclusiv pe fluxurile API de autentificare internă, dacă sunt activate.',
    duration: 'Până la 7 zile sau până la deconectare',
    installedInApp: true,
    notes: 'Nu este setat pentru vizitatorii anonimi ai site-ului public.'
  },
  {
    name: 'cosul_meu_admin_token / cosul_meu_admin_auth',
    mechanism: 'sessionStorage',
    category: 'necessary',
    provider: 'Coșul Meu (Consolă Administrare)',
    purpose: 'Păstrează sesiunea de administrare exclusiv pentru operatorul autentificat în panoul de administrare.',
    duration: 'Doar pe durata sesiunii curente a tab-ului browserului',
    installedInApp: true,
    notes: 'Nu se creează pentru utilizatorii obișnuiți.'
  },
  {
    name: 'cosul_meu_theme',
    mechanism: 'localStorage',
    category: 'preferences',
    provider: 'Coșul Meu',
    purpose: 'Memorează tema vizuală selectată de utilizator (Light / Dark / Sistem).',
    duration: 'Persistent până la ștergerea din browser',
    installedInApp: true,
    notes: 'Cheie locală fără identificatori personali.'
  },
  {
    name: 'cosul_meu_lists_v1 / cosul_meu_active_list_id / cosul_meu_receipts_v1 / cosul_meu_price_alerts_v1 / cosul_meu_tracked_products_v1 / cosul_meu_user_profile_v1',
    mechanism: 'localStorage',
    category: 'necessary',
    provider: 'Coșul Meu',
    purpose: 'Asigură funcționarea locală a listelor, bonurilor și preferințelor cerute de utilizator în sesiunea de navigare.',
    duration: 'Până la resetare, deconectare sau ștergerea datelor din browser',
    installedInApp: true,
    notes: 'Date de aplicație gestionate local în browser și sincronizate cu contul la autentificare.'
  },
  {
    name: 'Google Fonts (fonts.googleapis.com / fonts.gstatic.com)',
    mechanism: 'External Request',
    category: 'necessary',
    provider: 'Google',
    purpose: 'Încărcarea fonturilor Outfit și Plus Jakarta Sans pentru afișarea corectă a textului.',
    duration: 'Cache standard browser pentru fișiere statice',
    installedInApp: true,
    notes: 'Nu setează cookie-uri de tracking în aplicația Coșul Meu; generează o cerere HTTPS către CDN-ul Google Fonts.'
  },
  {
    name: 'Instrumente de analiză și trafic',
    mechanism: 'External Request',
    category: 'analytics',
    provider: 'Neutilizat în prezent',
    purpose: 'Niciun script de analiză nu este instalat sau încărcat în aplicație.',
    duration: '0 zile (inexistent)',
    installedInApp: false,
    notes: 'Infrastructura tehnică blochează orice script viitor de analiză până la acordarea consimțământului.'
  },
  {
    name: 'Scripturi de marketing și publicitate',
    mechanism: 'External Request',
    category: 'marketing',
    provider: 'Neutilizat în prezent',
    purpose: 'Niciun pixel publicitar sau tracker de marketing nu este instalat în aplicație.',
    duration: '0 zile (inexistent)',
    installedInApp: false,
    notes: 'Infrastructura tehnică blochează orice script viitor de marketing până la acordarea consimțământului.'
  }
];

/**
 * Configurație centralizată pentru un operator persoană fizică al platformei Coșul Meu.
 * Câmpurile marcate cu `[De completat...]` trebuie completate manual înainte de utilizarea publică oficială.
 * Nu sunt incluse date ale unei societăți comerciale inexistente.
 */
export const LEGAL_CONFIG = {
  platformName: 'Coșul Meu',
  lastUpdated: '[De completat: Data publicării / ultimei actualizări, ex. ZZ.LL.AAAA]',
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  cookiePolicyVersion: COOKIE_POLICY_VERSION,
  cookieBannerVersion: COOKIE_BANNER_VERSION,
  operator: {
    operatorType: 'individual' as const,
    fullName: '[De completat: Numele complet al operatorului persoană fizică]',
    country: 'România',
    contactEmail: '[De completat: Adresa oficială de email pentru contact]',
    contactPhone: '[De completat (opțional): Număr de telefon de contact]',
    website: 'https://cosulmeu.online/',
    activityDescription: 'Administrarea și actualizarea platformei Coșul Meu',
    businessRegistrationStatus:
      'Platforma este administrată și actualizată de o persoană fizică și nu este prezentată ca fiind operată de o societate comercială.'
  },
  contact: {
    privacyEmail: '[De completat: Adresa de email pentru solicitări GDPR / protecția datelor]',
    ipEmail: '[De completat: Adresa de email pentru notificări privind proprietatea intelectuală]',
    supportHours: '[De completat: Programul / termenul orientativ de răspuns la mesaje]'
  },
  terms: {
    complaintsResponseTime:
      '[De completat: Termenul maxim de răspuns la reclamațiile utilizatorilor]',
    disputeResolutionNote:
      '[De completat și validat juridic: Procedura aplicabilă de soluționare a disputelor și instanțele competente din România]',
    applicableLawNote:
      '[De completat și validat juridic: Precizări finale privind legea aplicabilă și eventualele norme imperative aplicabile]'
  },
  privacy: {
    legalBasesNote:
      'Fiecare operațiune de prelucrare are un temei juridic distinct conform art. 6 GDPR: executarea serviciului solicitat pentru cont, liste și bonuri (lit. b), obligație legală pentru solicitările GDPR și dovezile de consimțământ (lit. c), interes legitim pentru securitatea și integritatea tehnică a platformei (lit. f) și consimțământ expres separat exclusiv pentru comunicări opționale/marketing sau cookie-uri opționale (lit. a).',
    accountDataRetention:
      '[De completat și validat juridic: Perioada exactă de retenție după ștergerea contului sau inactivitate îndelungată]',
    receiptsDataRetention:
      '[De completat și validat juridic: Perioada de retenție pentru bonurile fiscale, observațiile personale și fotografiile încărcate]',
    technicalLogsRetention:
      '[De completat: Perioada de retenție pentru jurnalele tehnice și de securitate ale Vercel / Supabase]',
    processorsAndRegionsNote:
      '[De completat și validat juridic: Regiunile exacte configurate în Supabase și Vercel, împreună cu acordurile de prelucrare a datelor (DPA) semnate cu furnizorii]',
    internationalTransfersNote:
      '[De completat și validat juridic: Garanțiile de transfer aplicabile (ex. Clauze Contractuale Standard / cadre de adecvare) pentru furnizorii cu infrastructură sau subprocesatori în afara SEE]',
    gdprResponseTerm:
      'Conform art. 12 alin. (3) GDPR, termenul legal standard de răspuns este de cel mult 1 lună de la primirea cererii (cu posibilitate de prelungire motivată cu până la 2 luni în cazuri complexe). [De confirmat juridic]',
    supervisoryAuthorityDetails:
      'Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP) — B-dul G-ral. Gheorghe Magheru nr. 28-30, Sector 1, cod poștal 010336, București, România — www.dataprotection.ro [De verificat înainte de publicare]'
  },
  cookies: {
    sessionCookieDuration:
      'Sesiunea de autentificare Supabase rămâne activă până la deconectare sau expirarea tokenului; cookie-ul opțional HttpOnly de pe fluxurile API interne are durată de până la 7 zile. [De verificat în producție]',
    optionalAnalyticsStatus:
      'În prezent nu sunt instalate și nu se încarcă scripturi sau cookie-uri de analiză ori marketing. Sistemul de consimțământ blochează preventiv orice script opțional viitor fără acordul explicit al utilizatorului.',
    consentImplementationStatus:
      'Este implementat un mecanism activ de gestionare a consimțământului (banner la prima vizită sau la schimbarea versiunii politicii + modal „Setări cookie-uri” accesibil permanent din footer) și un controller centralizat care blochează scripturile opționale fără acord.'
  },
  ip: {
    noticeReviewTerm:
      '[De completat: Termenul orientativ de analiză și răspuns la notificările privind proprietatea intelectuală]'
  }
} as const;

export function isManualPlaceholder(value: string): boolean {
  return value.trim().startsWith('[De completat');
}
