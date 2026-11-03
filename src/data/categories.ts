// src/data/categories.ts
// Taxonomie extensibilă de categorii și subcategorii pentru Coșul Meu
// Include reguli de mapare automată din denumirile retailerilor și cuvinte-cheie

export interface SubCategory {
  id: string;
  name: string;
  slug: string;
  keywords: string[];
}

export interface CategoryDefinition {
  id: string;
  name: string;
  slug: string;
  iconName: string; // lucide icon identifier
  description: string;
  subcategories: SubCategory[];
  keywords: string[];
}

export const CATEGORIES_TAXONOMY: CategoryDefinition[] = [
  {
    id: 'cat-fructe-legume',
    name: 'Fructe și legume',
    slug: 'fructe-si-legume',
    iconName: 'Apple',
    description: 'Fructe proaspete, legume de sezon, verdețuri și ciuperci',
    keywords: ['fructe', 'legume', 'mere', 'banane', 'rosii', 'cartofi', 'ceapa', 'morcovi', 'portocale', 'ardei', 'castraveti', 'ciuperci', 'salata', 'patrunjel', 'struguri'],
    subcategories: [
      { id: 'sub-legume-proaspete', name: 'Legume proaspete', slug: 'legume-proaspete', keywords: ['cartofi', 'rosii', 'ceapa', 'morcovi', 'ardei', 'castraveti', 'varza'] },
      { id: 'sub-fructe-proaspete', name: 'Fructe proaspete', slug: 'fructe-proaspete', keywords: ['mere', 'banane', 'portocale', 'lamaie', 'mandarine', 'struguri', 'pere'] },
      { id: 'sub-verdeturi', name: 'Verdețuri & Plante aromatice', slug: 'verdeturi', keywords: ['salata', 'patrunjel', 'marar', 'ceapa verde', 'spanac', 'busuioc'] }
    ]
  },
  {
    id: 'cat-lactate-oua',
    name: 'Lactate și ouă',
    slug: 'lactate-si-oua',
    iconName: 'Milk',
    description: 'Lapte, brânzeturi, iaurturi, unt, smântână și ouă proaspete',
    keywords: ['lapte', 'oua', 'iaurt', 'telemea', 'cascaval', 'unt', 'smantana', 'branza', 'kefir', 'sana', 'mozzarella'],
    subcategories: [
      { id: 'sub-lapte', name: 'Lapte & Băuturi lactate', slug: 'lapte', keywords: ['lapte proaspat', 'lapte uht', 'kefir', 'sana', 'lapte batut'] },
      { id: 'sub-branzeturi', name: 'Brânzeturi & Cașcaval', slug: 'branzeturi', keywords: ['telemea', 'cascaval', 'branza topita', 'mozzarella', 'parmezan', 'feta'] },
      { id: 'sub-iaurt-smantana', name: 'Iaurt & Smântână', slug: 'iaurt-smantana', keywords: ['iaurt grecesc', 'iaurt simplu', 'iaurt de baut', 'smantana 12%', 'smantana 20%'] },
      { id: 'sub-unt-margarina', name: 'Unt & Margarină', slug: 'unt-margarina', keywords: ['unt 82%', 'unt 65%', 'margarina'] },
      { id: 'sub-oua', name: 'Ouă de consum', slug: 'oua', keywords: ['oua proaspete', 'oua m', 'oua l', 'oua bio'] }
    ]
  },
  {
    id: 'cat-carne-peste',
    name: 'Carne și pește',
    slug: 'carne-si-peste',
    iconName: 'Beef',
    description: 'Carne de pasăre, porc, vită, mezeluri și pește proaspăt/afumat',
    keywords: ['carne', 'piept de pui', 'porc', 'vita', 'peste', 'mezeluri', 'salam', 'sunca', 'carnati', 'somon', 'ton'],
    subcategories: [
      { id: 'sub-carne-pasare', name: 'Carne de pasăre', slug: 'carne-pasare', keywords: ['pui', 'piept de pui', 'pulpe de pui', 'curcan', 'aripi pui'] },
      { id: 'sub-carne-porc-vita', name: 'Carne de porc & vită', slug: 'carne-porc-vita', keywords: ['porc', 'cotlet', 'ceafa', 'pulpa de porc', 'vita', 'antricot'] },
      { id: 'sub-mezeluri', name: 'Mezeluri & Specialități', slug: 'mezeluri', keywords: ['salam', 'sunca', 'carnati', 'parizer', 'bacon', 'muschiulet'] },
      { id: 'sub-peste-fructe-mare', name: 'Pește & Fructe de mare', slug: 'peste-fructe-mare', keywords: ['somon', 'pastrav', 'ton', 'dorada', 'creveti'] }
    ]
  },
  {
    id: 'cat-panificatie',
    name: 'Panificație',
    slug: 'panificatie',
    iconName: 'Croissant',
    description: 'Pâine proaspătă, toast, baghete, chifle și produse de patiserie',
    keywords: ['paine', 'toast', 'bagheta', 'chifla', 'covrigi', 'croissant', 'lipie', 'corn'],
    subcategories: [
      { id: 'sub-paine-toast', name: 'Pâine albă & Toast', slug: 'paine-toast', keywords: ['toast', 'paine feliata', 'paine alba', 'bagheta'] },
      { id: 'sub-paine-integrala', name: 'Pâine neagră & Secară', slug: 'paine-integrala', keywords: ['secara', 'neagra', 'graham', 'cereale', 'integrala'] },
      { id: 'sub-patiserie', name: 'Patiserie & Specialități', slug: 'patiserie', keywords: ['croissant', 'chifle', 'lipii', 'covrigi', 'cozonac'] }
    ]
  },
  {
    id: 'cat-produse-baza',
    name: 'Produse de bază',
    slug: 'produse-de-baza',
    iconName: 'Package',
    description: 'Ulei, făină, zahăr, orez, mălai, paste făinoase și conserve',
    keywords: ['ulei', 'faina', 'zahar', 'orez', 'paste', 'malai', 'otet', 'sare', 'conserve', 'bulion', 'fasole'],
    subcategories: [
      { id: 'sub-ulei-otet', name: 'Ulei & Oțet', slug: 'ulei-otet', keywords: ['ulei floarea soarelui', 'ulei masline', 'otet'] },
      { id: 'sub-faina-malai', name: 'Făină, Mălai & Griș', slug: 'faina-malai', keywords: ['faina 000', 'faina 650', 'malai', 'gris'] },
      { id: 'sub-zahar-sare', name: 'Zahăr & Sare', slug: 'zahar-sare', keywords: ['zahar cristal', 'zahar brun', 'sare fina', 'sare iodata'] },
      { id: 'sub-paste-orez', name: 'Paste făinoase & Orez', slug: 'paste-orez', keywords: ['spaghetti', 'penne', 'orez bob rotund', 'orez basmati'] },
      { id: 'sub-conserve', name: 'Conserve & Sosuri', slug: 'conserve', keywords: ['rosii cuburi', 'bulion', 'pasta tomate', 'mazare', 'fasole boabe'] }
    ]
  },
  {
    id: 'cat-bauturi',
    name: 'Băuturi',
    slug: 'bauturi',
    iconName: 'Coffee',
    description: 'Apă minerală, sucuri, cafea, ceai, bere și vinuri',
    keywords: ['apa minerala', 'apa plata', 'cafea', 'ceai', 'suc', 'bere', 'vin', 'cola', 'pepsi', 'nectar'],
    subcategories: [
      { id: 'sub-apa', name: 'Apă plată & minerală', slug: 'apa', keywords: ['apa minerala', 'apa plata', 'carbogazoasa', 'plata'] },
      { id: 'sub-cafea-ceai', name: 'Cafea & Ceai', slug: 'cafea-ceai', keywords: ['cafea macinata', 'cafea boabe', 'capsule', 'ceai negru', 'ceai verde'] },
      { id: 'sub-sucuri', name: 'Sucuri & Răcoritoare', slug: 'sucuri', keywords: ['suc portocale', 'cola', 'limonada', 'nectar'] }
    ]
  },
  {
    id: 'cat-produse-congelate',
    name: 'Produse congelate',
    slug: 'produse-congelate',
    iconName: 'Snowflake',
    description: 'Legume congelate, pește congelat, pizza și înghețată',
    keywords: ['congelat', 'legume congelate', 'pizza congelata', 'inghetata', 'peste congelat'],
    subcategories: [
      { id: 'sub-legume-congelate', name: 'Legume congelate', slug: 'legume-congelate', keywords: ['amestec legume', 'mazare congelata', 'spanac congelat'] },
      { id: 'sub-semipreparate', name: 'Semipreparate congelate', slug: 'semipreparate', keywords: ['pizza', 'nuggets', 'peste pane', 'aluat'] }
    ]
  },
  {
    id: 'cat-curatenie',
    name: 'Curățenie',
    slug: 'curatenie',
    iconName: 'Sparkles',
    description: 'Detergent de rufe, detergent vase, soluții pardoseli și lavete',
    keywords: ['detergent', 'detergent vase', 'balsam rufe', 'solutie geamuri', 'clor', 'lavete', 'dezinfectant'],
    subcategories: [
      { id: 'sub-detergent-vase', name: 'Detergent de vase', slug: 'detergent-vase', keywords: ['detergent vase', 'tablete masina spalat vase'] },
      { id: 'sub-detergent-rufe', name: 'Detergent & Balsam rufe', slug: 'detergent-rufe', keywords: ['detergent rufe', 'balsam', 'capsule rufe'] },
      { id: 'sub-solutii-curatenie', name: 'Soluții universale & Pardoseli', slug: 'solutii-curatenie', keywords: ['solutie pardoseli', 'geamuri', 'degresant'] }
    ]
  },
  {
    id: 'cat-igiena-personala',
    name: 'Igienă personală',
    slug: 'igiena-personala',
    iconName: 'Heart',
    description: 'Hârtie igienică, pastă de dinți, săpun, șampon și gel de duș',
    keywords: ['hartie igienica', 'pasta dinti', 'sapun', 'sampon', 'gel de dus', 'servetele', 'deodorant'],
    subcategories: [
      { id: 'sub-hartie-servetele', name: 'Hârtie igienică & Șervețele', slug: 'hartie-servetele', keywords: ['hartie igienica', 'prosoape bucatarie', 'servetele nazale'] },
      { id: 'sub-ingrijire-dentara', name: 'Pastă de dinți & Igienă orală', slug: 'ingrijire-dentara', keywords: ['pasta de dinti', 'periuta dinti', 'apa de gura'] },
      { id: 'sub-ingrijire-corp', name: 'Săpun & Îngrijire corp', slug: 'ingrijire-corp', keywords: ['sapun lichid', 'gel de dus', 'sampon', 'deodorant'] }
    ]
  },
  {
    id: 'cat-alte-produse',
    name: 'Alte produse',
    slug: 'alte-produse',
    iconName: 'MoreHorizontal',
    description: 'Produse diverse și articole nesortate',
    keywords: ['diverse', 'altele', 'bazar', 'accesorii'],
    subcategories: []
  }
];

/**
 * Mapează un text brut sau categoria unui retailer într-o categorie canonică din catalog
 */
export function mapRetailerCategoryToStandard(
  rawCategoryOrTitle: string
): { category: string; subcategory?: string } {
  if (!rawCategoryOrTitle) {
    return { category: 'Alte produse' };
  }

  const clean = rawCategoryOrTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Căutare potrivire în taxonomie
  for (const cat of CATEGORIES_TAXONOMY) {
    // Verificăm subcategoriile mai întâi pentru acuratețe
    for (const sub of cat.subcategories) {
      if (sub.keywords.some(kw => clean.includes(kw))) {
        return { category: cat.name, subcategory: sub.name };
      }
    }
    // Verificăm cuvintele-cheie ale categoriei
    if (cat.keywords.some(kw => clean.includes(kw))) {
      return { category: cat.name, subcategory: cat.subcategories[0]?.name };
    }
  }

  return { category: 'Alte produse' };
}
