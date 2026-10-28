import http from 'http';
import { app, ADMIN_API_KEY } from '../server';

async function runSecurityTest() {
  console.log('🧪 Rulare Test de Securitate pentru Endpoint-urile Administrative (/api/admin/*)...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
      failed++;
    }
  }

  // Pornim un server HTTP de test pe un port efemer (0)
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // --- TEST 1: Cererea fără token la /api/admin/sources-info este respinsă cu 401 ---
    const resNoAuth = await fetch(`${baseUrl}/api/admin/sources-info`);
    const dataNoAuth = await resNoAuth.json();
    assert(resNoAuth.status === 401, `Cererea fără token returnează 401 Unauthorized (obținut: ${resNoAuth.status})`);
    assert(dataNoAuth.error?.includes('Token administrativ lipsă') || dataNoAuth.error?.includes('neautorizat'), 'Mesajul de eroare specifică lipsa tokenului');

    // --- TEST 2: Cererea cu token invalid la /api/admin/sources-info este respinsă cu 403 ---
    const resBadToken = await fetch(`${baseUrl}/api/admin/sources-info`, {
      headers: {
        'Authorization': 'Bearer token-fals-si-incorect-1234'
      }
    });
    const dataBadToken = await resBadToken.json();
    assert(resBadToken.status === 403, `Cererea cu token invalid returnează 403 Forbidden (obținut: ${resBadToken.status})`);
    assert(dataBadToken.error?.includes('invalid'), 'Mesajul de eroare semnalează token invalid');

    // --- TEST 3: Cererea cu token valid la /api/admin/sources-info returnează 200 OK ---
    const resValidAuth = await fetch(`${baseUrl}/api/admin/sources-info`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      }
    });
    const dataValidAuth = await resValidAuth.json();
    assert(resValidAuth.status === 200, `Cererea cu token valid returnează 200 OK (obținut: ${resValidAuth.status})`);
    assert(Array.isArray(dataValidAuth.sources) && dataValidAuth.sources.length >= 4, `Lista surselor este returnată doar pentru utilizatori autorizați (${dataValidAuth.sources?.length} surse)`);

    // --- TEST 4: /api/admin/verify-token verifică securitatea ---
    const resVerifyNoAuth = await fetch(`${baseUrl}/api/admin/verify-token`, { method: 'POST' });
    assert(resVerifyNoAuth.status === 401, `verify-token fără token returnează 401 (obținut: ${resVerifyNoAuth.status})`);

    const resVerifyBadAuth = await fetch(`${baseUrl}/api/admin/verify-token`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer bad-secret' }
    });
    assert(resVerifyBadAuth.status === 403, `verify-token cu token greșit returnează 403 (obținut: ${resVerifyBadAuth.status})`);

    const resVerifyGood = await fetch(`${baseUrl}/api/admin/verify-token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_API_KEY}` }
    });
    const dataVerifyGood = await resVerifyGood.json();
    assert(resVerifyGood.status === 200, `verify-token cu token corect returnează 200 (obținut: ${resVerifyGood.status})`);
    assert(dataVerifyGood.authorized === true, 'Răspunsul confirmă starea authorized: true');

    // --- TEST 5: Respingerea payload-urilor prea mari pe server (> 5MB) cu 413 ---
    console.log('\n--- Verificare limite de dimensiune a payload-ului (Max 5MB) ---');
    const largeContent = 'a'.repeat(5.5 * 1024 * 1024); // 5.5 MB string

    const resLarge = await fetch(`${baseUrl}/api/admin/validate-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        content: largeContent,
        format: 'csv'
      })
    });

    assert(resLarge.status === 413, `Payload-ul de 5.5MB este respins cu codul HTTP 413 Payload Too Large (obținut: ${resLarge.status})`);

    // --- TEST 6: Fișier valid sub 5MB este acceptat cu 200 OK ---
    const smallContent = 'denumire,pret,unitate\nPaine,4.50,buc';
    const resSmall = await fetch(`${baseUrl}/api/admin/validate-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        content: smallContent,
        format: 'csv'
      })
    });
    assert(resSmall.status === 200, `Fișier de dimensiune normală este acceptat cu 200 OK (obținut: ${resSmall.status})`);

    // --- TEST 7: Asigurare că erorile și răspunsurile NU expun secrete ---
    console.log('\n--- Verificare protecție împotriva scurgerilor de secrete ---');
    const allResponsesText = [
      JSON.stringify(dataNoAuth),
      JSON.stringify(dataBadToken),
      await resLarge.text()
    ].join(' ');

    assert(!allResponsesText.includes(ADMIN_API_KEY), 'Răspunsurile de eroare nu conțin și nu expun valoarea ADMIN_API_KEY');
    if (process.env.GEMINI_API_KEY) {
      assert(!allResponsesText.includes(process.env.GEMINI_API_KEY), 'Răspunsurile nu conțin valoarea GEMINI_API_KEY');
    }
    assert(!allResponsesText.includes('at Layer.handle'), 'Răspunsurile nu conțin stacktrace intern sau detalii de infrastructură');

    console.log(`\n🎉 Testul de securitate s-a încheiat cu succes: ${passed} trecute, ${failed} eșuate.`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSecurityTest();
