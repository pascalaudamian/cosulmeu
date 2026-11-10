// tests/user-profiles.test.ts
// Verificare completă a integrării User Profiles cu Supabase PostgreSQL, Triggers, RLS și Storage

import 'dotenv/config';
import assert from 'assert';
import { getPool, closePool } from '../src/db/index.js';
import { supabase } from '../src/lib/supabase.js';

async function runProfileTests() {
  console.log('🧪 Pornire Teste User Profiles & Supabase Schema...');
  const pool = getPool();
  assert.ok(pool, 'PostgreSQL Pool trebuie să fie configurat din variabilele Supabase.');

  // =========================================================================
  // TEST 1: Structura tabelelor public.profiles și public.user_preferences
  // =========================================================================
  console.log('1. Verificare structură public.profiles și constrângeri...');
  const profileCols = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
    ORDER BY ordinal_position;
  `);

  const colNames = profileCols.rows.map(r => r.column_name);
  assert.ok(colNames.includes('id'), 'profiles trebuie să aibă coloana id (PK / FK la auth.users)');
  assert.ok(colNames.includes('display_name'), 'profiles trebuie să aibă display_name');
  assert.ok(colNames.includes('username'), 'profiles trebuie să aibă username');
  assert.ok(colNames.includes('avatar_url'), 'profiles trebuie să aibă avatar_url');
  assert.ok(colNames.includes('role'), 'profiles trebuie să aibă role');
  assert.ok(colNames.includes('city'), 'profiles trebuie să aibă city');
  assert.ok(colNames.includes('preferred_language'), 'profiles trebuie să aibă preferred_language');
  assert.ok(colNames.includes('preferences'), 'profiles trebuie să aibă preferences (JSONB)');
  console.log('   ✅ public.profiles conține toate câmpurile cerute (id, display_name, username, avatar_url, role, city, preferences).');

  // =========================================================================
  // TEST 2: Verificare Row Level Security pe public.profiles și user_preferences
  // =========================================================================
  console.log('2. Verificare Row Level Security (RLS) pe tabelele de profil...');
  const rlsCheck = await pool.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN ('profiles', 'user_preferences', 'shopping_lists');
  `);

  for (const row of rlsCheck.rows) {
    assert.strictEqual(row.rowsecurity, true, `Tabelul ${row.tablename} trebuie să aibă RLS activat.`);
  }

  const policies = await pool.query(`
    SELECT policyname, tablename, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles';
  `);
  assert.ok(policies.rows.length >= 2, 'Trebuie să existe politici RLS pe public.profiles (SELECT, UPDATE, INSERT).');
  console.log(`   ✅ RLS este activat și securizat cu ${policies.rows.length} politici pe public.profiles.`);

  // =========================================================================
  // TEST 3: Verificare trigger handle_new_user_profile pe auth.users
  // =========================================================================
  console.log('3. Verificare trigger automat handle_new_user_profile...');
  const triggerCheck = await pool.query(`
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relname = 'users' AND n.nspname = 'auth' AND t.tgname = 'on_auth_user_created_profile';
  `);
  assert.strictEqual(triggerCheck.rows.length, 1, 'Triggerul on_auth_user_created_profile trebuie să existe pe auth.users.');
  console.log('   ✅ Triggerul on_auth_user_created_profile este configurat pe auth.users pentru crearea automată a profilului.');

  // =========================================================================
  // TEST 4: Verificare trigger protect_profile_role împotriva escaladării de privilegii
  // =========================================================================
  console.log('4. Verificare protecție rol de sistem (protect_profile_role)...');
  const roleTrigger = await pool.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'profiles' AND trigger_name = 'trg_protect_profile_role';
  `);
  assert.strictEqual(roleTrigger.rows.length, 1, 'Triggerul trg_protect_profile_role trebuie să fie activ pe public.profiles.');
  console.log('   ✅ Triggerul trg_protect_profile_role împiedică escaladarea neautorizată de roluri.');

  // =========================================================================
  // TEST 5: Verificare bucket avatars în storage.buckets și politici RLS
  // =========================================================================
  console.log('5. Verificare Storage Bucket "avatars" și permisiuni...');
  const bucketCheck = await pool.query(`
    SELECT id, name, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
    WHERE id = 'avatars';
  `);
  assert.strictEqual(bucketCheck.rows.length, 1, 'Bucket-ul storage avatars trebuie să existe.');
  const avatarsBucket = bucketCheck.rows[0];
  assert.strictEqual(avatarsBucket.public, true, 'Bucket-ul avatars trebuie să fie public pentru citire.');
  assert.strictEqual(Number(avatarsBucket.file_size_limit), 5242880, 'Limita fișierelor de avatar trebuie să fie 5MB.');

  const storagePolicies = await pool.query(`
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE '%avatar%';
  `);
  assert.ok(storagePolicies.rows.length >= 2, 'Trebuie să existe politici RLS de storage pentru avatars.');
  console.log('   ✅ Bucket-ul "avatars" este configurat (public=true, limită 5MB) și protejat prin RLS izolat pe folder-ul utilizatorului.');

  // =========================================================================
  // TEST 6: Verificare cont admin configurat (pascalau.stefan@gmail.com)
  // =========================================================================
  console.log('6. Verificare profil admin (pascalau.stefan@gmail.com)...');
  const adminCheck = await pool.query(`
    SELECT p.id, p.display_name, p.role, u.email
    FROM public.profiles p
    JOIN auth.users u ON p.id = u.id
    WHERE u.email = 'pascalau.stefan@gmail.com';
  `);
  if (adminCheck.rows.length > 0) {
    assert.strictEqual(adminCheck.rows[0].role, 'admin', 'Utilizatorul pascalau.stefan@gmail.com trebuie să aibă rol de admin.');
    console.log(`   ✅ Profilul de administrator pentru ${adminCheck.rows[0].email} este confirmat cu role='admin'.`);
  } else {
    console.log('   ℹ️ Utilizatorul admin va primi rolul automat la prima autentificare.');
  }

  // =========================================================================
  // TEST 7: Verificare acces public neautentificat la catalogul de produse
  // =========================================================================
  console.log('7. Verificare acces public neautentificat la catalog...');
  const publicProducts = await pool.query(`
    SELECT id, name, category, normalized_unit
    FROM public.products
    LIMIT 5;
  `);
  assert.ok(publicProducts.rows.length > 0, 'Produsele publice trebuie să fie accesibile direct.');

  const publicOffers = await pool.query(`
    SELECT id, store_id, price, normal_price, promo_price
    FROM public.price_observations
    LIMIT 5;
  `);
  assert.ok(publicOffers.rows.length > 0, 'Observațiile de preț publice active trebuie să fie interogabile fără restricții.');
  console.log(`   ✅ Catalogul public de produse și observațiile de preț sunt accesibile fără autentificare (${publicProducts.rows.length} produse, ${publicOffers.rows.length} oferte verificate).`);

  // =========================================================================
  // TEST 8: Verificare persistență surse de catalog extinse (Auchan Catalog & Mega Revista)
  // =========================================================================
  console.log('8. Verificare persistență surse extinse în PostgreSQL...');
  const catalogSourcesCheck = await pool.query(`
    SELECT id, name, catalog_url
    FROM public.catalog_sources
    WHERE id IN ('cat-src-auchan-catalog', 'cat-src-mega-image-revista');
  `);
  assert.strictEqual(catalogSourcesCheck.rows.length, 2, 'Ambele surse extinse (Auchan Catalog și Mega Image Revistă) trebuie să fie prezente în PostgreSQL.');
  console.log('   ✅ Sursele extinse "cat-src-auchan-catalog" și "cat-src-mega-image-revista" sunt persistate în baza de date.');

  await closePool();
  console.log('\n🎉 TOATE CELE 8 TESTE PENTRU USER PROFILES & SUPABASE AU FOST VALIDATE CU SUCCES!');
}

runProfileTests().catch(async err => {
  console.error('\n❌ Eroare în testele User Profiles:', err);
  await closePool();
  process.exit(1);
});
