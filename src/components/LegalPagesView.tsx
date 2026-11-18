import React from 'react';
import {
  ArrowLeft,
  Cookie,
  Copyright,
  FileText,
  Info,
  Mail,
  Scale,
  Shield,
  Tag,
  UserCheck
} from 'lucide-react';
import {
  COOKIE_BANNER_VERSION,
  COOKIE_CATEGORIES_CONFIG,
  COOKIE_POLICY_VERSION,
  DETECTED_COOKIES_AND_STORAGE,
  GDPR_PROCESSING_MATRIX,
  isManualPlaceholder,
  LEGAL_CONFIG,
  LEGAL_ROUTE_MAP,
  LEGAL_ROUTES,
  PRIVACY_POLICY_VERSION,
  TECHNICAL_PROVIDERS_CONFIG,
  type LegalRoutePath
} from '../config/legalConfig.js';

interface LegalPagesViewProps {
  route: LegalRoutePath;
  onNavigateHome: () => void;
  onNavigateLegal: (path: LegalRoutePath) => void;
  onOpenCookieSettings?: () => void;
}

const ROUTE_ICONS: Record<LegalRoutePath, React.ComponentType<{ className?: string }>> = {
  '/despre': Info,
  '/contact': Mail,
  '/termeni-si-conditii': FileText,
  '/disclaimer-preturi': Tag,
  '/proprietate-intelectuala': Copyright,
  '/politica-de-confidentialitate': Shield,
  '/politica-cookies': Cookie
};

const SECTION_LABELS: Record<'cosul-meu' | 'informatii' | 'confidentialitate', string> = {
  'cosul-meu': 'Coșul Meu',
  informatii: 'Informații',
  confidentialitate: 'Confidențialitate'
};

const ConfigValue: React.FC<{ value: string }> = ({ value }) => {
  if (isManualPlaceholder(value)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-amber-300/80 dark:border-amber-700/70 bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs sm:text-[13px] font-medium">
        {value}
      </span>
    );
  }
  return <span className="font-medium text-slate-900 dark:text-slate-100">{value}</span>;
};

interface LegalSectionProps {
  number: string;
  title: string;
  children: React.ReactNode;
}

const LegalSection: React.FC<LegalSectionProps> = ({ number, title, children }) => (
  <section className="space-y-3 pt-6 border-t border-slate-200/80 dark:border-slate-800 first:pt-0 first:border-t-0">
    <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-baseline gap-2.5">
      <span className="text-emerald-600 dark:text-emerald-400 tabular-nums text-base sm:text-lg">
        {number}.
      </span>
      <span>{title}</span>
    </h2>
    <div className="space-y-3 text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
      {children}
    </div>
  </section>
);

const OperatorIdentityBox: React.FC = () => (
  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 sm:p-5 space-y-2 text-sm">
    <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 pb-1">
      <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <span>Operator platformă (persoană fizică)</span>
    </div>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Nume complet: </span>
      <ConfigValue value={LEGAL_CONFIG.operator.fullName} />
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Statut administrare: </span>
      <span className="font-medium text-slate-900 dark:text-slate-100">
        Persoană fizică ({LEGAL_CONFIG.operator.operatorType}) —{' '}
      </span>
      <span>{LEGAL_CONFIG.operator.businessRegistrationStatus}</span>
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Țară: </span>
      <span className="font-medium text-slate-900 dark:text-slate-100">
        {LEGAL_CONFIG.operator.country}
      </span>
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Activitate: </span>
      <span>{LEGAL_CONFIG.operator.activityDescription}</span>
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Website: </span>
      <a
        href={LEGAL_CONFIG.operator.website}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-emerald-700 dark:text-emerald-400 hover:underline break-all"
      >
        {LEGAL_CONFIG.operator.website}
      </a>
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Email oficial de contact: </span>
      <ConfigValue value={LEGAL_CONFIG.operator.contactEmail} />
    </p>
    <p>
      <span className="text-slate-500 dark:text-slate-400">Telefon (opțional): </span>
      <ConfigValue value={LEGAL_CONFIG.operator.contactPhone} />
    </p>
  </div>
);

export const LegalPagesView: React.FC<LegalPagesViewProps> = ({
  route,
  onNavigateHome,
  onNavigateLegal,
  onOpenCookieSettings
}) => {
  const meta = LEGAL_ROUTE_MAP[route];
  const Icon = ROUTE_ICONS[route];

  const handleHomeClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigateHome();
  };

  const handleSiblingClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    targetPath: LegalRoutePath
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigateLegal(targetPath);
  };

  return (
    <div className="pb-12 space-y-6">
      {/* Top Navigation Back to Home */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="/"
          onClick={handleHomeClick}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-2xs transition-colors focus-visible:outline-emerald-600"
        >
          <ArrowLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Înapoi la pagina principală</span>
        </a>

        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-900/70 px-3 py-1 rounded-lg">
          {SECTION_LABELS[meta.section]}
        </span>
      </div>

      {/* Main Layout: Document Card + Secondary Index */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Document Article */}
        <article className="lg:col-span-8 surface-card rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <header className="space-y-3 pb-6 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-900/70 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
                  {meta.title}
                </h1>
              </div>
            </div>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
              {meta.summary}
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              <span>
                Data ultimei actualizări:{' '}
                <ConfigValue value={LEGAL_CONFIG.lastUpdated} />
              </span>
            </div>
          </header>

          {/* Route-specific structured content */}
          <div className="space-y-6">
            {/* ==============================================================
                1. /despre — DESPRE COȘUL MEU
               ============================================================== */}
            {route === '/despre' && (
              <>
                <LegalSection number="1" title="Scopul proiectului Coșul Meu">
                  <p>
                    <strong>Coșul Meu</strong> ({LEGAL_CONFIG.operator.website}) este o platformă
                    independentă de informare și comparare a prețurilor și ofertelor pentru produse
                    de consum curent din magazinele din România. Scopul proiectului este să ajute
                    utilizatorii să estimeze costul coșului de cumpărături, să compare ofertele
                    disponibile și să își urmărească cheltuielile personale într-un mod transparent.
                  </p>
                  <p>
                    Platforma nu comercializează direct produsele magazinelor, nu procesează plăți
                    pentru cumpărături și nu funcționează ca magazin online.
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Funcționalitățile platformei">
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <strong>Catalog de produse și oferte:</strong> consultarea produselor,
                      gramajelor și ofertelor asociate magazinelor din România, cu filtrare pe
                      categorii și orașe.
                    </li>
                    <li>
                      <strong>Liste de cumpărături:</strong> crearea și organizarea listelor de
                      produse, atât local în browser (fără cont), cât și sincronizat într-un cont
                      de utilizator.
                    </li>
                    <li>
                      <strong>Compararea prețurilor și optimizarea coșului:</strong> estimarea
                      costului total pe magazine, inclusiv evidențierea situațiilor în care o ofertă
                      depinde de carduri de fidelitate sau disponibilitate locală.
                    </li>
                    <li>
                      <strong>Scanarea bonurilor fiscale:</strong> încărcarea și interpretarea
                      bonurilor pentru extragerea articolelor și construirea unui istoric personal
                      de prețuri.
                    </li>
                    <li>
                      <strong>Evoluția prețurilor și alerte:</strong> urmărirea observațiilor de
                      preț în timp și configurarea alertelor de preț în cont.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection number="3" title="Caracterul independent al comparațiilor">
                  <p>
                    Coșul Meu este un proiect independent. Platforma nu are parteneriate comerciale
                    cu lanțurile de magazine afișate, nu este afiliată acestora și nu primește
                    comisioane pentru a favoriza un comerciant în detrimentul altuia.
                  </p>
                  <p>
                    Ordonarea comparațiilor de coș se bazează pe acoperirea produselor din listă și
                    pe prețul total estimat conform datelor disponibile în catalog.
                  </p>
                </LegalSection>

                <LegalSection number="4" title="Administrarea platformei">
                  <p>
                    Platforma este administrată și actualizată de o persoană fizică, fără a fi
                    operată de o societate comercială. Datele de identificare ale administratorului:
                  </p>
                  <OperatorIdentityBox />
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                2. /contact — CONTACT ȘI SESIZĂRI
               ============================================================== */}
            {route === '/contact' && (
              <>
                <LegalSection number="1" title="Canalul de contact al operatorului">
                  <p>
                    Pentru orice întrebare, sesizare sau solicitare referitoare la funcționarea
                    platformei <strong>Coșul Meu</strong>, poți contacta administratorul (persoană
                    fizică) folosind datele de mai jos:
                  </p>
                  <OperatorIdentityBox />
                  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2 text-sm">
                    <p>
                      <span className="text-slate-500 dark:text-slate-400">
                        Email dedicat solicitărilor GDPR:{' '}
                      </span>
                      <ConfigValue value={LEGAL_CONFIG.contact.privacyEmail} />
                    </p>
                    <p>
                      <span className="text-slate-500 dark:text-slate-400">
                        Email dedicat notificărilor de proprietate intelectuală:{' '}
                      </span>
                      <ConfigValue value={LEGAL_CONFIG.contact.ipEmail} />
                    </p>
                    <p>
                      <span className="text-slate-500 dark:text-slate-400">
                        Program / termen orientativ de răspuns:{' '}
                      </span>
                      <ConfigValue value={LEGAL_CONFIG.contact.supportHours} />
                    </p>
                  </div>
                </LegalSection>

                <LegalSection number="2" title="Categorii de sesizări și solicitări">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        1. Întrebări generale
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Clarificări despre funcționarea comparațiilor, listelor, contului sau
                        scanării bonurilor.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        2. Erori de preț
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Semnalarea diferențelor între prețul afișat în platformă și cel de la raft
                        (menționează produsul, magazinul, orașul și data).
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        3. Oferte expirate
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Raportarea promoțiilor sau ofertelor care nu mai sunt valabile la comerciant.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        4. Reclamații
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Sesizări privind probleme tehnice, conținut inexact sau funcționarea
                        serviciului.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        5. Notificări privind proprietatea intelectuală
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Solicitări din partea titularilor de drepturi pentru verificarea,
                        corectarea sau eliminarea unor materiale.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-1">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        6. Solicitări GDPR
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                        Cereri de acces, rectificare, ștergere, restricționare, portabilitate sau
                        opoziție privind datele personale.
                      </p>
                    </div>
                  </div>
                </LegalSection>

                <LegalSection number="3" title="Delimitare față de magazine">
                  <p>
                    Operatorul platformei Coșul Meu nu reprezintă magazinele afișate, nu poate
                    modifica prețurile din magazine și nu poate soluționa reclamații referitoare la
                    produse achiziționate direct de la comercianți, bonuri fiscale emise de aceștia
                    sau comenzi plasate pe site-urile retailerilor.
                  </p>
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                3. /termeni-si-conditii — TERMENI ȘI CONDIȚII
               ============================================================== */}
            {route === '/termeni-si-conditii' && (
              <>
                <LegalSection number="1" title="Identitatea operatorului">
                  <p>
                    Prezenții Termeni și condiții reglementează accesul și utilizarea platformei web{' '}
                    <strong>Coșul Meu</strong> ({LEGAL_CONFIG.operator.website}), administrată și
                    actualizată de o persoană fizică, fără a fi operată prin intermediul unei
                    societăți comerciale.
                  </p>
                  <OperatorIdentityBox />
                  <p>
                    Datele de contact ale administratorului sunt furnizate exclusiv pentru
                    identificarea operatorului platformei și nu trebuie confundate cu datele personale
                    ale utilizatorilor aplicației.
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Descrierea și scopul platformei Coșul Meu">
                  <p>
                    Coșul Meu este un instrument online independent de informare și comparare a
                    prețurilor și ofertelor pentru produse din magazinele din România. Scopul
                    platformei este să ofere utilizatorilor posibilitatea de a consulta produse, de
                    a estima costul unui coș de cumpărături și de a își organiza listele și istoricul
                    personal de bonuri.
                  </p>
                  <p>
                    Platforma nu vinde direct produsele afișate, nu procesează comenzi sau plăți
                    comerciale și nu acționează ca intermediar de vânzare în numele comercianților.
                  </p>
                </LegalSection>

                <LegalSection number="3" title="Caracterul independent">
                  <p>
                    Platforma funcționează independent de lanțurile de retail listate. Afișarea
                    numelor magazinelor și a ofertelor nu presupune existența unor parteneriate,
                    contracte comerciale sau afilieri cu respectivele magazine.
                  </p>
                </LegalSection>

                <LegalSection number="4" title="Regulile de utilizare">
                  <p>Utilizatorii au dreptul să acceseze platforma în scop personal și informativ. Este interzisă:</p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      utilizarea de instrumente automatizate pentru extragerea masivă a datelor
                      (scraping abuziv) sau perturbarea funcționării serverelor;
                    </li>
                    <li>
                      încercarea de accesare neautorizată a secțiunilor administrative, a datelor
                      altor utilizatori sau a mecanismelor de securitate;
                    </li>
                    <li>
                      introducerea sau încărcarea de conținut malițios, ilegal ori care încalcă
                      drepturile altor persoane.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection number="5" title="Condițiile conturilor de utilizator">
                  <p>
                    Catalogul public și funcțiile de bază ale comparației pot fi utilizate fără
                    autentificare. Crearea unui cont este opțională și permite sincronizarea datelor
                    personale din aplicație (profil, preferințe, liste, alerte și bonuri).
                  </p>
                  <p>
                    Pentru crearea și utilizarea contului, utilizatorul trebuie să furnizeze o adresă
                    de email validă, să păstreze confidențialitatea parolei și să anunțe operatorul
                    dacă suspectează o utilizare neautorizată a contului său.
                  </p>
                </LegalSection>

                <LegalSection number="6" title="Listele de cumpărături și compararea prețurilor">
                  <p>
                    În modul fără cont, listele create de utilizator sunt salvate exclusiv local în
                    browserul dispozitivului; în modul autentificat, listele sunt sincronizate în
                    cont. Compararea prețurilor calculează estimări orientative pe baza ofertelor
                    disponibile în platformă, a orașului ales și a setărilor privind cardurile de
                    fidelitate.
                  </p>
                </LegalSection>

                <LegalSection number="7" title="Scanarea bonurilor fiscale">
                  <p>
                    Funcția de scanare a bonurilor permite încărcarea fotografiilor bonurilor
                    fiscale pentru extragerea produselor și prețurilor și păstrarea unui istoric
                    personal. Rezultatele extragerii automate pot conține erori de recunoaștere,
                    motiv pentru care utilizatorul are posibilitatea și responsabilitatea de a verifica
                    și corecta datele înainte de salvare.
                  </p>
                  <p>
                    Utilizatorul trebuie să încarce doar bonuri proprii sau pe care are dreptul să le
                    stocheze și să evite încărcarea de documente fără legătură cu cumpărăturile sau
                    care expun inutil date sensibile ale altor persoane.
                  </p>
                </LegalSection>

                <LegalSection number="8" title="Responsabilitățile utilizatorilor">
                  <p>
                    Utilizatorul este responsabil pentru modul în care folosește informațiile
                    orientative din platformă, pentru verificarea prețului final și a condițiilor de
                    vânzare direct la comerciant înainte de achiziție și pentru legalitatea
                    fișierelor încărcate în propriul cont.
                  </p>
                </LegalSection>

                <LegalSection number="9" title="Limitele serviciului și responsabilitatea legală">
                  <p>
                    Operatorul depune diligențe rezonabile pentru funcționarea corectă a platformei
                    și actualizarea datelor, însă disponibilitatea aplicației poate fi întreruptă
                    temporar pentru mentenanță, actualizări tehnice sau cauze externe ce țin de
                    infrastructura de găzduire ori de sursele de date.
                  </p>
                  <p>
                    Faptul că platforma este administrată de o persoană fizică nu elimină obligațiile
                    legale aplicabile în materia protecției datelor, drepturilor de autor, comerțului
                    electronic sau altor norme legale incidente. Nicio prevedere din acești Termeni
                    nu exclude și nu limitează răspunderea operatorului în cazurile în care legea
                    aplicabilă interzice excluderea sau limitarea acesteia.
                  </p>
                </LegalSection>

                <LegalSection number="10" title="Procedura de reclamații, disputa și legea aplicabilă">
                  <p>
                    <strong>Procedura de reclamații:</strong> Orice reclamație privind funcționarea
                    platformei sau informațiile afișate poate fi trimisă prin datele din pagina{' '}
                    <a
                      href="/contact"
                      onClick={e => handleSiblingClick(e, '/contact')}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      Contact
                    </a>
                    , incluzând o descriere clară a situației. Termenul orientativ de răspuns:{' '}
                    <ConfigValue value={LEGAL_CONFIG.terms.complaintsResponseTime} />
                  </p>
                  <p>
                    <strong>Soluționarea disputelor:</strong> Părțile vor urmări cu prioritate
                    soluționarea amiabilă a neînțelegerilor.{' '}
                    <ConfigValue value={LEGAL_CONFIG.terms.disputeResolutionNote} />
                  </p>
                  <p>
                    <strong>Legea aplicabilă:</strong>{' '}
                    <ConfigValue value={LEGAL_CONFIG.terms.applicableLawNote} />
                  </p>
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                4. /disclaimer-preturi — DISCLAIMER PREȚURI ȘI OFERTE
               ============================================================== */}
            {route === '/disclaimer-preturi' && (
              <>
                <LegalSection number="1" title="Statut independent și lipsa calității de comerciant">
                  <p>
                    <strong>Coșul Meu</strong> este un comparator independent de prețuri și oferte,
                    administrat de o persoană fizică ({LEGAL_CONFIG.operator.website}). Platforma nu
                    este deținută și nu este operată de o societate comercială, nu reprezintă
                    magazinele afișate și nu are parteneriate comerciale cu acestea.
                  </p>
                  <p>
                    Coșul Meu <strong>nu este comerciantul produselor</strong> prezentate în catalog
                    și nu vinde, nu livrează și nu garantează stocul niciunui produs.
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Sursele datelor și data colectării">
                  <p>
                    Informațiile despre produse, prețuri și promoții provin din surse publice sau
                    autorizate (cataloage, pagini publice de oferte și structuri de date
                    disponibile în sistem).
                  </p>
                  <p>
                    Atunci când este disponibilă în structura datelor unei oferte,{' '}
                    <strong>data colectării</strong> sau a ultimei actualizări este afișată pentru
                    transparență. Cu toate acestea, prețurile pot fi actualizate cu întârziere față de
                    modificările efectuate în timp real de către comercianți.
                  </p>
                </LegalSection>

                <LegalSection number="3" title="Variații locale și condiții promoționale">
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <strong>Localitate și magazin:</strong> prețurile și disponibilitatea pot varia
                      în funcție de oraș, magazinul fizic specific sau formatul comercial (hipermarket,
                      supermarket, magazin de proximitate, online).
                    </li>
                    <li>
                      <strong>Carduri de fidelitate:</strong> anumite oferte sau reduceri afișate
                      pot depinde de utilizarea unui card ori aplicații de fidelitate a
                      comerciantului, de cupoane active sau de condiții de cantitate.
                    </li>
                    <li>
                      <strong>Produse cântărite și variante:</strong> diferențele de gramaj, lot sau
                      ambalaj pot influența prețul final calculat la casă.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection number="4" title="Confirmarea prețului final la comerciant">
                  <p>
                    Utilizatorul trebuie să confirme întotdeauna prețul final, termenii promoției și
                    disponibilitatea produsului direct la raft, pe eticheta din magazin sau în pagina
                    oficială de plată a comerciantului înainte de a efectua achiziția.
                  </p>
                </LegalSection>

                <LegalSection number="5" title="Raportarea erorilor și limitele disclaimerului">
                  <p>
                    Dacă identifici un preț greșit sau o ofertă expirată, ne poți sesiza prin
                    pagina{' '}
                    <a
                      href="/contact"
                      onClick={e => handleSiblingClick(e, '/contact')}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      Contact
                    </a>{' '}
                    pentru verificare și actualizare. Prezentul disclaimer are scop informativ și nu
                    este utilizat ca mijloc de eliminare a obligațiilor legale ale operatorului și
                    nici nu exclude răspunderea acolo unde legea aplicabilă nu permite excluderea.
                  </p>
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                5. /politica-de-confidentialitate — POLITICA DE CONFIDENȚIALITATE
               ============================================================== */}
            {route === '/politica-de-confidentialitate' && (
              <>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Versiune Politică de confidențialitate:{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {PRIVACY_POLICY_VERSION}
                    </strong>
                  </span>
                  <span>Operator: Persoană fizică · {LEGAL_CONFIG.operator.country}</span>
                </div>

                <LegalSection number="1" title="Identitatea și datele de contact ale operatorului">
                  <p>
                    Platforma <strong>Coșul Meu</strong> ({LEGAL_CONFIG.operator.website}) este
                    administrată și actualizată de o persoană fizică, fără a fi operată prin
                    intermediul unei societăți comerciale. În sensul Regulamentului (UE) 2016/679
                    (GDPR), persoana fizică ce stabilește scopurile și mijloacele de prelucrare este
                    operatorul de date:
                  </p>
                  <OperatorIdentityBox />
                  <p>
                    Pentru solicitări legate de protecția datelor personale, ne poți contacta la:{' '}
                    <ConfigValue value={LEGAL_CONFIG.contact.privacyEmail} /> (sau prin datele din
                    pagina{' '}
                    <a
                      href="/contact"
                      onClick={e => handleSiblingClick(e, '/contact')}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      Contact
                    </a>
                    ).
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Ce date personale sunt prelucrate în funcție de utilizare">
                  <p>
                    Coșul Meu colectează exclusiv datele necesare fiecărei funcționalități pe care
                    alegi să o utilizezi. Nu este obligatoriu să îți creezi cont pentru a consulta
                    catalogul public.
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      <strong>Date de identificare și contact (opționale sau de cont):</strong>{' '}
                      adresă de email și parolă (procesată de Supabase Auth) pentru autentificare;
                      opțional prenume, nume, nume afișat, nume de utilizator și număr de telefon
                      dacă alegi să le completezi în profil.
                    </li>
                    <li>
                      <strong>Date asociate contului și utilizării aplicației:</strong> ID utilizator,
                      preferințe (oraș, limbă, temă Light/Dark/Sistem, magazine preferate, obiectiv
                      de economii, opțiune carduri de fidelitate), liste de cumpărături, produse
                      urmărite și alerte de preț.
                    </li>
                    <li>
                      <strong>Bonuri fiscale încărcate:</strong> imagini JPG/PNG/WEBP stocate în
                      bucket-ul privat <code>receipt-images</code> din Supabase Storage (accesate
                      prin URL-uri semnate temporar) și informațiile extrase sau corectate de tine
                      (comerciant, dată, produse, cantități, prețuri, observații personale).
                    </li>
                    <li>
                      <strong>Evidențe de consimțământ și solicitări GDPR:</strong> preferințe
                      cookie, identificator pseudonimizat de sesiune vizitator, acord sau retragere
                      pentru comunicări opționale/marketing și istoricul cererilor tale GDPR.
                    </li>
                    <li>
                      <strong>Date tehnice și de securitate:</strong> adresă IP (procesată tehnic de
                      infrastructura web și de autentificare), tip browser/User-Agent, timestamp și
                      jurnale tehnice de eroare sau securitate.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection number="3" title="Matricea scopurilor de prelucrare, datelor și temeiurilor juridice">
                  <p>
                    Nu toate prelucrările se bazează pe consimțământ. Fiecare categorie de date este
                    prelucrată în baza unui temei juridic distinct conform art. 6 GDPR:
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200">
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="p-3 font-bold">Scop</th>
                          <th className="p-3 font-bold">Date prelucrate</th>
                          <th className="p-3 font-bold">Temei juridic</th>
                          <th className="p-3 font-bold">Retenție</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                        {GDPR_PROCESSING_MATRIX.map(row => (
                          <tr key={row.id} className="align-top">
                            <td className="p-3 font-semibold text-slate-900 dark:text-slate-100 min-w-[170px]">
                              {row.purpose}
                            </td>
                            <td className="p-3 min-w-[200px]">{row.dataCategories}</td>
                            <td className="p-3 min-w-[170px]">
                              <div className="font-medium text-slate-800 dark:text-slate-200">
                                {row.legalBasis}
                              </div>
                              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                {row.gdprArticle}
                              </div>
                            </td>
                            <td className="p-3 min-w-[160px]">{row.retention}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </LegalSection>

                <LegalSection number="4" title="Sursa datelor și caracterul obligatoriu sau opțional">
                  <p>
                    Datele personale provin direct de la tine (la înregistrare, în profil, la
                    crearea listelor sau la încărcarea bonurilor) ori sunt generate tehnic în timpul
                    utilizării aplicației (ex. identificatori de sesiune, evidențe consimțământ).
                  </p>
                  <p>
                    Adresa de email și parola sunt necesare exclusiv dacă dorești crearea unui cont.
                    Prenumele, numele, numărul de telefon, avatarul și abonarea la comunicări
                    opționale sau newsletter sunt complet opționale — refuzul lor nu împiedică
                    utilizarea platformei sau crearea contului.
                  </p>
                </LegalSection>

                <LegalSection number="5" title="Furnizori tehnici și categorii de destinatari">
                  <p>
                    În funcționarea efectivă a codului aplicației intervin următoarele servicii
                    tehnice:
                  </p>
                  <div className="space-y-2.5">
                    {TECHNICAL_PROVIDERS_CONFIG.map(provider => (
                      <div
                        key={provider.id}
                        className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 text-xs space-y-1"
                      >
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          {provider.name}
                        </div>
                        <p>
                          <strong>Rol:</strong> {provider.role}
                        </p>
                        <p>
                          <strong>Date prelucrate:</strong> {provider.dataProcessed}
                        </p>
                        <p>
                          <strong>Regiune / Configurare:</strong>{' '}
                          <ConfigValue value={provider.regionStatus} />
                        </p>
                        <p>
                          <strong>Garanții / DPA:</strong>{' '}
                          <ConfigValue value={provider.transferSafeguards} />
                        </p>
                      </div>
                    ))}
                  </div>
                  <p>
                    <strong>Datele utilizatorilor nu sunt vândute către terți</strong> și aplicația
                    nu include rețele de publicitate sau brokeri de date.
                  </p>
                </LegalSection>

                <LegalSection number="6" title="Transferuri internaționale de date">
                  <p>
                    Utilizarea infrastructurii cloud moderne (Supabase, Vercel, servicii Google)
                    poate implica procesarea sau tranzitul unor date tehnice ori de conținut în afara
                    Spațiului Economic European (SEE), în funcție de regiunea configurată și de
                    subprocesatorii furnizorilor.{' '}
                    <ConfigValue value={LEGAL_CONFIG.privacy.internationalTransfersNote} />
                  </p>
                </LegalSection>

                <LegalSection number="7" title="Perioade de retenție și excepții justificate la ștergere">
                  <div className="space-y-2">
                    <p>
                      <strong>Datele contului și profilului:</strong>{' '}
                      <ConfigValue value={LEGAL_CONFIG.privacy.accountDataRetention} />
                    </p>
                    <p>
                      <strong>Bonurile fiscale și fotografiile încărcate:</strong>{' '}
                      <ConfigValue value={LEGAL_CONFIG.privacy.receiptsDataRetention} />
                    </p>
                    <p>
                      <strong>Jurnalele tehnice și de securitate:</strong>{' '}
                      <ConfigValue value={LEGAL_CONFIG.privacy.technicalLogsRetention} />
                    </p>
                    <p>
                      <strong>Excepții la ștergerea contului:</strong> La solicitarea ștergerii
                      contului, imaginile private ale bonurilor, avatarul, listele, alertele,
                      observațiile de preț și profilul sunt șterse. Pot fi păstrate exclusiv dovezi
                      minime pseudonimizate sau fără identificatori direcți (de ex. hash ireversibil
                      SHA-256 al operațiunii și dovada anonimizată a consimțământului cookie) atunci
                      când există o obligație legală de evidență ori un interes legitim justificat de
                      apărare/securitate, precum și jurnalele tehnice de infrastructură până la
                      expirarea ferestrei lor standard de retenție.
                    </p>
                  </div>
                </LegalSection>

                <LegalSection number="8" title="Drepturile persoanelor vizate și instrumentele din cont">
                  <p>Conform GDPR (art. 15–22 și art. 7), beneficiezi de:</p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <strong>Dreptul de acces și export (portabilitate):</strong> poți consulta
                      direct datele asociate contului și le poți descărca în format{' '}
                      <code>JSON</code> sau <code>CSV</code> din secțiunea{' '}
                      <em>Profil → Confidențialitate și date personale</em>.
                    </li>
                    <li>
                      <strong>Dreptul la rectificare:</strong> poți modifica direct numele,
                      prenumele, telefonul, orașul, limba sau adresa de email.
                    </li>
                    <li>
                      <strong>Dreptul la ștergere („dreptul de a fi uitat”):</strong> poți șterge
                      bonuri individuale, memoria locală sau întregul cont prin funcția{' '}
                      <em>„Șterge contul”</em> (cu reautentificare și confirmare explicită).
                    </li>
                    <li>
                      <strong>Dreptul la restricționarea prelucrării și opoziție:</strong> poți
                      marca solicitarea de restricționare sau depune o cerere structurată din cont.
                    </li>
                    <li>
                      <strong>Retragerea consimțământului:</strong> pentru comunicări opționale /
                      newsletter (din Profil) și pentru cookie-uri opționale (din{' '}
                      <button
                        type="button"
                        onClick={() => onOpenCookieSettings?.()}
                        className="font-semibold text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
                      >
                        Setări cookie-uri
                      </button>
                      ), fără a afecta legalitatea prelucrării anterioare.
                    </li>
                  </ul>
                  <p>
                    <strong>Termen de răspuns la solicitări:</strong>{' '}
                    <ConfigValue value={LEGAL_CONFIG.privacy.gdprResponseTerm} />
                  </p>
                </LegalSection>

                <LegalSection number="9" title="Dreptul de a depune plângere la ANSPDCP">
                  <p>
                    Dacă apreciezi că prelucrarea datelor tale încalcă legislația aplicabilă, ai
                    dreptul să depui o plângere la autoritatea de supraveghere competentă:{' '}
                    <ConfigValue value={LEGAL_CONFIG.privacy.supervisoryAuthorityDetails} />
                  </p>
                </LegalSection>

                <LegalSection number="10" title="Lipsa deciziilor automate cu efecte juridice">
                  <p>
                    Coșul Meu nu ia decizii exclusiv automate, inclusiv profilare, care să producă
                    efecte juridice sau să te afecteze semnificativ în sensul art. 22 GDPR.
                    Comparațiile de prețuri și extragerea OCR a bonurilor sunt instrumente asistate,
                    cu rol informativ și editabile manual de utilizator.
                  </p>
                </LegalSection>

                <LegalSection number="11" title="Datele minorilor">
                  <p>
                    Platforma și crearea unui cont de utilizator se adresează persoanelor care au
                    vârsta legală necesară pentru a consimți în mod valabil la servicii ale
                    societății informaționale (cel puțin 16 ani în România, conform aplicării GDPR).
                    Nu colectăm cu bună știință date ale copiilor sub această vârstă.
                  </p>
                </LegalSection>

                <LegalSection number="12" title="Securitatea datelor și modificarea politicii">
                  <p>
                    Aplicația utilizează comunicații HTTPS, politici PostgreSQL Row Level Security
                    (RLS) pe tabelele personale, bucket privat cu URL-uri semnate temporar pentru
                    imaginile bonurilor și validare strictă a cererilor API. Nu facem promisiuni
                    exagerate privind sisteme sau certificări pe care infrastructura nu le deține.
                  </p>
                  <p>
                    Modificările substanțiale ale acestei politici vor actualiza versiunea afișată (
                    <span className="font-mono">{PRIVACY_POLICY_VERSION}</span>) și data ultimei
                    actualizări.
                  </p>
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                6. /politica-cookies — POLITICA COOKIES
               ============================================================== */}
            {route === '/politica-cookies' && (
              <>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Versiune Politică cookies:{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {COOKIE_POLICY_VERSION}
                    </strong>{' '}
                    · Versiune banner:{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {COOKIE_BANNER_VERSION}
                    </strong>
                  </span>
                  {onOpenCookieSettings && (
                    <button
                      type="button"
                      onClick={onOpenCookieSettings}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer"
                    >
                      Deschide Setări cookie-uri
                    </button>
                  )}
                </div>

                <LegalSection number="1" title="Ce sunt cookie-urile și tehnologiile similare">
                  <p>
                    Cookie-urile sunt fișiere text mici stocate de browser la vizitarea unui site.
                    Aplicațiile web moderne utilizează de asemenea mecanisme de stocare locală în
                    browser (<code>localStorage</code> și <code>sessionStorage</code>) pentru a
                    păstra preferințele sau sesiunea activă.
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Categorii de cookie-uri și starea reală din aplicație">
                  <p>
                    Bannerul și panoul de preferințe sunt structurate pe 4 categorii. Categoriile
                    opționale sunt <strong>dezactivate implicit</strong> și nu încarcă scripturi
                    fără acordul tău explicit:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {COOKIE_CATEGORIES_CONFIG.map(cat => (
                      <div
                        key={cat.id}
                        className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                            {cat.name}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                              cat.required
                                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                                : cat.installedInApp
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {cat.required
                              ? 'Mereu active'
                              : cat.installedInApp
                                ? 'Opțional (activabil)'
                                : 'Neutilizat în prezent'}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {cat.description}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400">
                          <strong>Durată:</strong> {cat.retention}
                        </p>
                      </div>
                    ))}
                  </div>
                </LegalSection>

                <LegalSection number="3" title="Tabel tehnic real: cookie-uri, stocare locală și cereri externe">
                  <p>
                    Tabelul de mai jos este generat din configurația tehnică a aplicației și
                    reflectă exclusiv mecanismele identificate real în cod:
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200">
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="p-3 font-bold">Denumire</th>
                          <th className="p-3 font-bold">Mecanism</th>
                          <th className="p-3 font-bold">Categorie</th>
                          <th className="p-3 font-bold">Furnizor</th>
                          <th className="p-3 font-bold">Scop</th>
                          <th className="p-3 font-bold">Durată</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                        {DETECTED_COOKIES_AND_STORAGE.map(item => (
                          <tr key={item.name} className="align-top">
                            <td className="p-3 font-mono text-[11px] text-slate-900 dark:text-slate-100 min-w-[170px] break-all">
                              {item.name}
                            </td>
                            <td className="p-3 whitespace-nowrap">{item.mechanism}</td>
                            <td className="p-3 whitespace-nowrap">{item.category}</td>
                            <td className="p-3 whitespace-nowrap">{item.provider}</td>
                            <td className="p-3 min-w-[210px]">
                              <div>{item.purpose}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {item.notes}
                              </div>
                            </td>
                            <td className="p-3 min-w-[150px]">{item.duration}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </LegalSection>

                <LegalSection number="4" title="Gestionarea, modificarea și retragerea consimțământului">
                  <p>
                    <strong>Mecanism activ de consimțământ:</strong>{' '}
                    {LEGAL_CONFIG.cookies.consentImplementationStatus}
                  </p>
                  <p>
                    <strong>Limitări privind cookie-urile terților:</strong> Dacă vor fi activate
                    ulterior instrumente externe cu consimțământul tău, retragerea consimțământului
                    va opri încărcarea lor la vizitele următoare și va șterge cookie-urile
                    controlate de domeniul Coșul Meu; cookie-urile setate eventual de domenii terțe
                    pot necesita ștergerea din setările browserului tău.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {onOpenCookieSettings && (
                      <button
                        type="button"
                        onClick={onOpenCookieSettings}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        Modifică sau retrage setările cookie-uri
                      </button>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Link disponibil permanent în subsolul paginii („Setări cookie-uri”).
                    </span>
                  </div>
                </LegalSection>
              </>
            )}

            {/* ==============================================================
                7. /proprietate-intelectuala — PROPRIETATE INTELECTUALĂ
               ============================================================== */}
            {route === '/proprietate-intelectuala' && (
              <>
                <LegalSection number="1" title="Drepturile asupra platformei Coșul Meu">
                  <p>
                    Codul sursă, arhitectura aplicației, designul interfeței, structura paginilor și
                    textele originale ale platformei <strong>Coșul Meu</strong> aparțin
                    administratorului platformei (<ConfigValue value={LEGAL_CONFIG.operator.fullName} />)
                    sau sunt utilizate în baza licențelor aplicabile (inclusiv pachete software
                    open-source folosite conform licențelor lor).
                  </p>
                </LegalSection>

                <LegalSection number="2" title="Denumirile comerciale, mărcile și materialele retailerilor">
                  <p>
                    Denumirile comerciale ale supermarketurilor, mărcile înregistrate, logourile,
                    fotografiile de produs, cataloagele și descrierile comerciale afișate aparțin
                    titularilor lor de drept (retaileri, producători sau distribuitori).
                  </p>
                  <p>
                    <strong>Precizare importantă:</strong> Faptul că informațiile despre oferte și
                    produse sunt accesibile public nu înseamnă că acestea sunt libere de drepturi de
                    autor, de marcă sau alte drepturi de proprietate intelectuală. Utilizarea
                    denumirilor comerciale ale magazinelor în Coșul Meu are scop strict descriptiv,
                    pentru identificarea produselor și a retailerilor în vederea comparării
                    prețurilor, fără a sugera afiliere, sponsorizare sau aprobare din partea
                    titularilor.
                  </p>
                </LegalSection>

                <LegalSection number="3" title="Utilizarea permisă de către utilizatori">
                  <p>
                    Utilizatorii pot consulta platforma și își pot tipări sau exporta propriile liste
                    de cumpărături pentru uz personal, necomercial. Nu sunt permise copierea
                    sistematică a conținutului, reproducerea interfeței proprii sau exploatarea
                    comercială a materialelor fără permisiunea titularilor de drepturi.
                  </p>
                </LegalSection>

                <LegalSection number="4" title="Procedura de notificare, verificare și remediere">
                  <p>
                    Dacă ești titularul unui drept de proprietate intelectuală (drept de autor,
                    marcă, drept asupra imaginilor, cataloagelor sau descrierilor) și consideri că
                    un material afișat pe Coșul Meu îți încalcă drepturile, poți transmite o
                    notificare la adresa{' '}
                    <ConfigValue value={LEGAL_CONFIG.contact.ipEmail} /> (sau prin pagina{' '}
                    <a
                      href="/contact"
                      onClick={e => handleSiblingClick(e, '/contact')}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      Contact
                    </a>
                    ).
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <strong>Informații necesare:</strong> identificarea exactă a materialului sau
                      paginii vizate, indicarea dreptului invocat și datele tale de contact pentru
                      corespondență.
                    </li>
                    <li>
                      <strong>Verificarea solicitărilor:</strong> operatorul analizează cu bună
                      credință fiecare notificare primită. Termen orientativ de analiză:{' '}
                      <ConfigValue value={LEGAL_CONFIG.ip.noticeReviewTerm} />
                    </li>
                    <li>
                      <strong>Corectare sau eliminare:</strong> atunci când solicitarea este
                      justificată sau dreptul invocat este confirmat, materialele vizate sunt
                      corectate, înlocuite sau eliminate cu promptitudine.
                    </li>
                  </ul>
                </LegalSection>
              </>
            )}
          </div>
        </article>

        {/* Secondary Sidebar Navigation across Legal/Info Pages */}
        <aside
          aria-label="Alte pagini informative și juridice"
          className="lg:col-span-4 surface-card rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 lg:sticky lg:top-28"
        >
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Scale className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-bold">Documente și informații</h2>
          </div>

          <nav aria-label="Navigare pagini juridice" className="space-y-1.5">
            {LEGAL_ROUTES.map(item => {
              const ItemIcon = ROUTE_ICONS[item.path];
              const active = item.path === route;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  onClick={e => handleSiblingClick(e, item.path)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                    active
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-200/70 dark:border-emerald-900/70'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
                  }`}
                >
                  <ItemIcon
                    className={`w-4 h-4 shrink-0 ${
                      active
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span className="leading-snug">{item.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Toate paginile informative sunt accesibile public, fără a fi necesară autentificarea în
            cont.
          </div>
        </aside>
      </div>
    </div>
  );
};
