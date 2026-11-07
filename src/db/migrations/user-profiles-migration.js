// src/db/migrations/user-profiles-migration.js
import pg from 'pg';

const rawConn =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  'postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const connectionString = rawConn
  .replace(/([?&])ssl(mode|cert|key|rootcert)=[^&]*/gi, '$1')
  .replace(/[?&]$/, '');

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

export async function runUserProfilesMigration() {
  const client = await pool.connect();
  try {
    console.log('--- Rulare migrație: User Profiles & Securitate Supabase ---');
    await client.query('BEGIN');

    // 1. Extindere tabela profiles dacă există deja sau creare completă
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        display_name TEXT,
        first_name TEXT,
        last_name TEXT,
        username TEXT UNIQUE,
        avatar_url TEXT,
        bio TEXT,
        phone TEXT,
        phone_number TEXT,
        city TEXT DEFAULT 'București',
        preferred_store_id TEXT,
        preferred_language TEXT NOT NULL DEFAULT 'ro',
        role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Asigurare coloane lipsă dacă tabela a fost parțial creată anterior
    await client.query(`
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'ro';
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'București';
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_store_id TEXT;
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // 2. Protecție role împotriva modificărilor neautorizate
    await client.query(`
      CREATE OR REPLACE FUNCTION public.protect_profile_role()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
          -- Numai service_role poate modifica rolul utilizatorului
          IF current_user <> 'service_role' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
            NEW.role := OLD.role;
          END IF;
        END IF;
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
      CREATE TRIGGER trg_protect_profile_role
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();
    `);

    // 3. Trigger automat de creare profil la înregistrare în auth.users
    await client.query(`
      CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
      RETURNS trigger AS $$
      DECLARE
        initial_role VARCHAR(16) := 'user';
        initial_username TEXT;
      BEGIN
        -- Dacă utilizatorul are specificat emailul admin-ului sau is_admin în metadata
        IF new.email = 'pascalau.stefan@gmail.com' OR (new.raw_user_meta_data ->> 'is_admin')::boolean = true THEN
          initial_role := 'admin';
        END IF;

        initial_username := COALESCE(
          new.raw_user_meta_data ->> 'username',
          split_part(new.email, '@', 1) || '_' || substr(md5(random()::text), 1, 4)
        );

        INSERT INTO public.profiles (
          id, 
          first_name, 
          last_name, 
          display_name, 
          username,
          avatar_url,
          role,
          phone,
          phone_number,
          city,
          preferred_language,
          preferences
        ) VALUES (
          new.id, 
          new.raw_user_meta_data ->> 'first_name', 
          new.raw_user_meta_data ->> 'last_name', 
          COALESCE(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
          initial_username,
          new.raw_user_meta_data ->> 'avatar_url',
          initial_role,
          new.raw_user_meta_data ->> 'phone',
          COALESCE(new.raw_user_meta_data ->> 'phone_number', new.raw_user_meta_data ->> 'phone'),
          COALESCE(new.raw_user_meta_data ->> 'city', 'București'),
          COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro'),
          '{}'::jsonb
        ) ON CONFLICT (id) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
          username = COALESCE(profiles.username, EXCLUDED.username),
          role = CASE WHEN profiles.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
          updated_at = NOW();

        INSERT INTO public.user_preferences (user_id, language) 
        VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro')) 
        ON CONFLICT (user_id) DO NOTHING;

        RETURN new;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
      CREATE TRIGGER on_auth_user_created_profile
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();
    `);

    // 4. Activare RLS pe profiles
    await client.query(`
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
      CREATE POLICY profiles_select_policy ON public.profiles
        FOR SELECT
        USING (auth.uid() = id OR auth.role() = 'service_role');

      DROP POLICY IF EXISTS profiles_insert_policy ON public.profiles;
      CREATE POLICY profiles_insert_policy ON public.profiles
        FOR INSERT
        WITH CHECK (auth.uid() = id OR auth.role() = 'service_role');

      DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
      CREATE POLICY profiles_update_policy ON public.profiles
        FOR UPDATE
        USING (auth.uid() = id OR auth.role() = 'service_role')
        WITH CHECK (auth.uid() = id OR auth.role() = 'service_role');

      DROP POLICY IF EXISTS profiles_delete_policy ON public.profiles;
      CREATE POLICY profiles_delete_policy ON public.profiles
        FOR DELETE
        USING (auth.uid() = id OR auth.role() = 'service_role');
    `);

    // 5. Bucket de stocare pentru avatare în storage.buckets & politici storage.objects
    await client.query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'avatars',
        'avatars',
        true,
        5242880,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
      )
      ON CONFLICT (id) DO UPDATE SET
        public = true,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

      -- Politici storage pentru bucketul avatars
      DROP POLICY IF EXISTS "Public avatars are viewable by everyone" ON storage.objects;
      CREATE POLICY "Public avatars are viewable by everyone" ON storage.objects
        FOR SELECT
        USING (bucket_id = 'avatars');

      DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
      CREATE POLICY "Users can upload their own avatar" ON storage.objects
        FOR INSERT
        WITH CHECK (
          bucket_id = 'avatars' 
          AND (auth.uid()::text = (storage.foldername(name))[1] OR auth.uid()::text = split_part(name, '/', 1))
        );

      DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
      CREATE POLICY "Users can update their own avatar" ON storage.objects
        FOR UPDATE
        USING (
          bucket_id = 'avatars' 
          AND (auth.uid()::text = (storage.foldername(name))[1] OR auth.uid()::text = split_part(name, '/', 1))
        );

      DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
      CREATE POLICY "Users can delete their own avatar" ON storage.objects
        FOR DELETE
        USING (
          bucket_id = 'avatars' 
          AND (auth.uid()::text = (storage.foldername(name))[1] OR auth.uid()::text = split_part(name, '/', 1))
        );
    `);

    // Sincronizare utilizatori auth existenți cu profiles
    await client.query(`
      INSERT INTO public.profiles (id, display_name, username, role, city, preferred_language)
      SELECT 
        u.id,
        COALESCE(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
        split_part(u.email, '@', 1) || '_' || substr(u.id::text, 1, 4),
        CASE WHEN u.email = 'pascalau.stefan@gmail.com' THEN 'admin' ELSE 'user' END,
        'București',
        'ro'
      FROM auth.users u
      ON CONFLICT (id) DO UPDATE SET
        role = CASE WHEN EXCLUDED.id IN (SELECT id FROM auth.users WHERE email = 'pascalau.stefan@gmail.com') THEN 'admin' ELSE profiles.role END;
    `);

    await client.query('COMMIT');
    console.log('✅ Migrație User Profiles și Storage finalizată cu succes!');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Eșec la migrația User Profiles:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runUserProfilesMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
