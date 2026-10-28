

Acest document descrie arhitectura bazei de date relaționale, migrațiile, constrângerile de imuabilitate pentru istoricul prețurilor și pașii de lansare în producție pentru aplicația **Coșul Meu**.

---

## 1. Arhitectura de Date & Moduri de Funcționare

Aplicația implementează un **Data Access Layer (DAL)** hibrid și decuplat:
- **Modul Producție / Centralizat (`postgresql`):**
  - Activat automat atunci când sunt prezente variabilele de mediu pentru PostgreSQL (`DATABASE_URL`, `SUPABASE_DB_URL` sau `SQL_*`).
  - Toate operațiile administrative (import fișiere, sincronizare feed-uri, revizuire candidați fără cod de bare) se execută server-side și persistă în baza de date centralizată.
  - Utilizatorii accesează aceleași prețuri actualizate și același catalog național.
- **Modul Demonstrativ / Local (`demo_memory` & `localStorage`):**
  - În absența unei baze de date configurate sau în caz de indisponibilitate a rețelei, aplicația recurge automat și transparent la modul demo.
  - Niciun import temporar nu este raportat fals ca fiind persistent; interfața și API-ul semnalează explicit starea: `persisted: false`, `persistenceMode: 'demo_memory'`.

---

## 2. Schema Tabelelor și Constrângeri de Integritate

Schema DDL completă este definită în `src/db/schema.sql` și include:

### `stores` (Magazine & Supermarketuri)
- Cheie primară: `id VARCHAR(64)` (ex: `'lidl'`, `'kaufland'`, `'carrefour'`).
- Constrângere: `slug VARCHAR(64) UNIQUE`.
- Conține metadate de rețea, culori de brand și adrese reprezentative.

### `products` (Catalog Unificat de Produse)
- Cheie primară: `id VARCHAR(64)`.
- Index parțial unic pe cod de bare: `CREATE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;`.
- Indexuri pe categorii și brand pentru filtrare rapidă.
- Câmpuri de normalizare gramaj: `package_weight_or_volume`, `package_unit`, `normalized_unit` (`kg`, `l`, `buc`).

### `product_offers` (Oferte Curente Magazin)
- Cheie primară: `id VARCHAR(64)`.
- Cheie externă cu ștergere în cascadă: `product_id REFERENCES products(id)`, `store_id REFERENCES stores(id)`.
- **Constrângere unică de integritate:** `CONSTRAINT uq_product_store UNIQUE (product_id, store_id)`.
- Fiecare produs are cel mult o ofertă activă curentă per magazin. Actualizarea se realizează prin clauza `ON CONFLICT (product_id, store_id) DO UPDATE`.

### `price_observations` (Audit Istoric Imuabil / APPEND-ONLY)
- **Garanție absolută de imuabilitate:** Pe acest tabel se execută exclusiv operații de `INSERT`. Nicio actualizare sau ștergere nu este permisă.
- Cheie primară: `id VARCHAR(64)`.
- **Constrângere de idempotență:** `CONSTRAINT uq_daily_price_obs UNIQUE (product_id, store_id, date, price)`.
- Previne dublarea artificială a observațiilor dacă același fișier este importat de mai multe ori în aceeași zi, păstrând în același timp toate evoluțiile de preț în timp.
- Index compus descrescător: `CREATE INDEX idx_price_obs_product_date ON price_observations(product_id, date DESC);` pentru generarea instantanee a graficelor evolutive.

### `product_match_candidates` (Recenzare Asocieri fără GTIN)
- Păstrează produsele importate cu scor de similaritate mediu (0.45 – 0.68) care necesită confirmare umană din partea echipei administrative (`pending_confirmation`).

### `source_sync_runs` (Jurnal de Audit și Sincronizare)
- Înregistrează istoricul fiecărui import (linii procesate, oferte importate, duplicate, erori, mod de persistență utilizat).

---

## 3. Configurare Variabile de Mediu

Aplicația detectează automat furnizorul de PostgreSQL în următoarea ordine de prioritate:

### Opțiunea A: Supabase sau PostgreSQL Standard prin URL (Recomandat Cloud)
În fișierul `.env`:
```bash
DATABASE_URL="postgresql://postgres:[PAROLA_SECRETĂ]@[HOST_PROIECT].supabase.co:5432/postgres"
# SAU
SUPABASE_DB_URL="postgresql://postgres:[PAROLA_SECRETĂ]@[HOST_PROIECT].supabase.co:5432/postgres"
```

### Opțiunea B: Google Cloud SQL
Când aplicația este găzduită în Google Cloud cu Cloud SQL Auth Proxy:
```bash
SQL_HOST="/cloudsql/[ID_PROIECT]:[REGIUNE]:[NUME_INSTANȚĂ]"
SQL_USER="cosul_app_user"
SQL_PASSWORD="[PAROLA_UTILIZATOR]"
SQL_DB_NAME="cosul_meu"
```

### Opțiunea C: Parametri Standard PostgreSQL (Docker / On-Premise)
```bash
PGHOST="localhost"
PGPORT="5432"
PGUSER="postgres"
PGPASSWORD="[PAROLA_POSTGRES]"
PGDATABASE="cosul_meu"
PGSSLMODE="prefer"
```

---

## 4. Rularea Migrațiilor și Inițializarea Bazei de Date

### Inițializare automată (Recomandat):
La pornirea serverului, dacă este detectată o configurație PostgreSQL validă, metoda `DatabaseService.initializeSchemaAndSeed()`:
1. Creează toate tabelele, constrângerile și indexurile dacă acestea nu există (`CREATE TABLE IF NOT EXISTS`).
2. Dacă tabelul `products` este gol, injectează automat catalogul de bază și magazinele reprezentative.

### Rulare manuală prin CLI (psql):
Dacă doriți să rulați manual migrațiile pe o bază de date nouă:
```bash
psql "$DATABASE_URL" -f src/db/schema.sql
```

---

## 5. Verificare Funcționare și Monitorizare

Puteți verifica în orice moment starea conexiunii și modul activ de stocare apelând endpoint-ul dedicat:
```bash
curl -s http://localhost:3000/api/storage/status | jq
```

Răspuns când PostgreSQL este conectat:
```json
{
  "success": true,
  "configured": true,
  "connected": true,
  "persistenceMode": "postgresql",
  "dbType": "supabase",
  "message": "Conectat cu succes la PostgreSQL (postgres)"
}
```

Răspuns când rulează în mod demonstrativ:
```json
{
  "success": true,
  "configured": false,
  "connected": false,
  "persistenceMode": "demo_memory",
  "dbType": "none",
  "message": "PostgreSQL nu este configurat în variabilele de mediu. Se utilizează modul demonstrativ."
}
```

---

## 6. Checklist pentru Lansarea în Producție

1. **Securitate & Secrete:**
   - Nu commiteți niciodată fișiere `.env` cu parole reale în repository.
   - Setați `ADMIN_API_KEY` cu o cheie criptografică generată aleatoriu (minim 32 caractere).
2. **Dimensionare Connection Pool:**
   - Implicit, pool-ul este configurat la `max: 10` conexiuni simultane cu `connectionTimeoutMillis: 5000` pentru a preveni epuizarea socket-urilor pe containere serverless.
3. **Backup & Retenție:**
   - Configurați backup zilnic automat (Point-in-Time Recovery) pentru tabelele `product_offers` și `price_observations`.
4. **Izolarea Drepturilor Utilizatorului DB:**
   - În producție, utilizați un utilizator cu drepturi de `SELECT`, `INSERT`, `UPDATE` pe date, fără permisiuni de `DROP TABLE` sau `ALTER DATABASE`.
