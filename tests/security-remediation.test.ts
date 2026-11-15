// tests/security-remediation.test.ts
// Suită completă de teste de securitate și persistență pentru cele 6 remedieri din code review:
// P1 SSRF & DNS rebinding, P2 Streaming limits & zlib bomb protection, P2 Image security & proxy,
// P2 official_url persistence (Pool + Supabase fallback), P3 Modal URL validation & accessibility.

import 'dotenv/config';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';

import { CatalogDownloader, RequestTransport } from '../src/indexing/catalog/CatalogDownloader.ts';
import { CatalogParserEngine } from '../src/indexing/catalog/CatalogParserEngine.ts';
import { getSafeProductImageSrc, isPublicIpAddress, validatePublicHttpUrl } from '../src/utils/urlSecurity.ts';
import { supabase } from '../src/lib/supabase.ts';

// 1x1 PNG valid (raster PNG signature 89 50 4E 47 0D 0A 1A 0A)
const VALID_1X1_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

interface MockServerReply {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string>;
  writeChunks: (res: PassThrough, reqAborted: () => boolean) => void;
}

/**
 * Creează un RequestTransport de test peste stream-uri Node autentice (PassThrough),
 * permițând simularea redirecționărilor, chunked transfer fără Content-Length,
 * răspunsuri lente, fluxuri întrerupte, payload-uri gzip/zip-bomb și verificarea IP pinning-ului.
 */
function createStreamTestTransport(
  handler: (reqInfo: {
    protocol: string;
    hostname: string;
    port: string | number;
    path: string;
    headers: Record<string, any>;
    pinnedAddress?: { address: string; family: number };
    servername?: string;
  }) => MockServerReply
): {
  transport: RequestTransport;
  capturedRequests: Array<{ hostname: string; path: string; hostHeader?: string; pinnedIp?: string; servername?: string }>;
} {
  const capturedRequests: Array<{ hostname: string; path: string; hostHeader?: string; pinnedIp?: string; servername?: string }> = [];

  const makeRequestFn = (protocolDefault: string) => {
    return ((options: any, cb?: (res: any) => void) => {
      const req = new EventEmitter() as any;
      req.destroyed = false;
      req.destroy = (err?: Error) => {
        req.destroyed = true;
        if (err) req.emit('error', err);
      };
      req.end = () => {
        const finalizeLookup = (err: any, addressOrList: any, family?: number) => {
          if (err) {
            req.emit('error', err);
            return;
          }
          const pinned = Array.isArray(addressOrList)
            ? addressOrList[0]
            : { address: addressOrList, family: family || 4 };

          const socket = new EventEmitter() as any;
          socket.remoteAddress = pinned.address;
          socket.destroyed = false;
          socket.destroy = (sockErr?: Error) => {
            socket.destroyed = true;
            if (sockErr) req.emit('error', sockErr);
          };
          req.socket = socket;
          req.emit('socket', socket);
          socket.emit('connect');

          if (req.destroyed || socket.destroyed) return;

          capturedRequests.push({
            hostname: options.hostname,
            path: options.path,
            hostHeader: options.headers?.Host || options.hostname,
            pinnedIp: pinned.address,
            servername: options.servername
          });

          const reply = handler({
            protocol: options.protocol || protocolDefault,
            hostname: options.hostname,
            port: options.port,
            path: options.path,
            headers: options.headers || {},
            pinnedAddress: pinned,
            servername: options.servername
          });

          const res = new PassThrough() as any;
          res.statusCode = reply.statusCode;
          res.statusMessage = reply.statusMessage || '';
          res.headers = Object.fromEntries(
            Object.entries(reply.headers).map(([k, v]) => [k.toLowerCase(), v])
          );
          res.socket = socket;
          const origResDestroy = res.destroy.bind(res);
          res.destroy = (resErr?: Error) => {
            req.destroyed = true;
            return origResDestroy(resErr);
          };

          if (cb) cb(res);
          reply.writeChunks(res, () => req.destroyed || res.destroyed);
        };

        if (typeof options.lookup === 'function') {
          options.lookup(options.hostname, { all: true }, finalizeLookup);
        } else {
          finalizeLookup(null, [{ address: '93.184.216.34', family: 4 }]);
        }
      };
      return req;
    }) as any;
  };

  return {
    transport: {
      httpRequest: makeRequestFn('http:'),
      httpsRequest: makeRequestFn('https:')
    },
    capturedRequests
  };
}

describe('Security Remediation Suite (P1 SSRF, P2 Streaming, P2 Image Proxy, P2 official_url, P3 Modal)', () => {
  const origDnsLookup = CatalogDownloader.dnsLookup;
  const origTransport = CatalogDownloader.requestTransport;

  afterEach(() => {
    CatalogDownloader.dnsLookup = origDnsLookup;
    CatalogDownloader.requestTransport = origTransport;
  });

  // =========================================================================
  // 1. P1 – SSRF, notații IP alternative, DNS & DNS rebinding, Redirects
  // =========================================================================
  describe('P1 – SSRF & DNS Rebinding Protection', () => {
    it('respinge toate schemele nepermise, localhost, IP-uri private/rezervate IPv4/IPv6 și notații alternative', async () => {
      const blockedTargets = [
        'http://localhost:3000/api/admin',
        'http://localhost./api/admin',
        'http://sub.localhost/test',
        'http://127.0.0.1/secret',
        'http://127.12.34.56/secret',
        'http://10.0.0.1/admin',
        'http://172.16.0.1/internal',
        'http://172.31.255.254/internal',
        'http://192.168.1.1/router',
        'http://169.254.169.254/latest/meta-data/',
        'http://0.0.0.0:8080/',
        'http://100.64.0.1/cgnat',
        'http://[::1]/admin',
        'http://[0:0:0:0:0:0:0:1]/admin',
        'http://[fc00::1]/ula',
        'http://[fd12:3456::1]/ula',
        'http://[fe80::1]/link-local',
        'http://[ff02::1]/multicast',
        'http://[2002:7f00:0001::1]/6to4',
        // Notații alternative IP bypass
        'http://0x7f000001/hex-loopback',
        'http://2130706433/decimal-loopback',
        'http://0177.0.0.1/octal-loopback',
        'http://127.1/short-loopback',
        'http://[::ffff:127.0.0.1]/ipv4-mapped',
        'http://[::ffff:7f00:1]/ipv4-mapped-hex',
        'http://[::ffff:169.254.169.254]/ipv4-mapped-metadata',
        // Parser confusion / credențiale și protocoale periculoase
        'http://lidl.ro@127.0.0.1/',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://ftp.retailer.ro/catalog.pdf'
      ];

      for (const target of blockedTargets) {
        const safety = CatalogDownloader.validatePublicUrlSafety(target);
        assert.strictEqual(safety.safe, false, `Trebuia blocat target-ul SSRF: ${target}`);
        const dlRes = await CatalogDownloader.downloadCatalog(target, { maxRetries: 0 });
        assert.strictEqual(dlRes.ok, false);
        assert.strictEqual(dlRes.errorCode, 'SSRF_BLOCKED', `Trebuia SSRF_BLOCKED pentru: ${target}`);
      }

      // Adrese publice legitime (IPv4 & IPv6 Global Unicast) trebuie acceptate
      assert.strictEqual(isPublicIpAddress('93.184.216.34'), true);
      assert.strictEqual(isPublicIpAddress('2606:4700:4700::1111'), true);
      assert.strictEqual(validatePublicHttpUrl('https://www.lidl.ro/cataloage').safe, true);
      assert.strictEqual(validatePublicHttpUrl('https://catalog.example.ro:8443/oferte.html').safe, true);
    });

    it('blochează hostname public care se rezolvă DNS către IP privat sau set mixt (public + privat)', async () => {
      CatalogDownloader.dnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];
      const resPrivate = await CatalogDownloader.downloadCatalog('https://rebind.attacker.example/feed', {
        maxRetries: 0
      });
      assert.strictEqual(resPrivate.ok, false);
      assert.strictEqual(resPrivate.errorCode, 'SSRF_BLOCKED');

      CatalogDownloader.dnsLookup = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.10.20', family: 4 }
      ];
      const resMixed = await CatalogDownloader.downloadCatalog('https://dualstack.attacker.example/feed', {
        maxRetries: 0
      });
      assert.strictEqual(resMixed.ok, false);
      assert.strictEqual(resMixed.errorCode, 'SSRF_BLOCKED');
    });

    it('previne DNS rebinding: rezolvă o singură dată per hop, fixează IP-ul la socket și blochează discrepanțele remoteAddress', async () => {
      let lookupCalls = 0;
      CatalogDownloader.dnsLookup = async (hostname: string) => {
        lookupCalls++;
        if (lookupCalls === 1 && hostname === 'rebind-protect.example.ro') {
          return [{ address: '93.184.216.34', family: 4 }];
        }
        // Dacă s-ar mai face o a doua rezoluție DNS, ar returna IP intern
        return [{ address: '127.0.0.1', family: 4 }];
      };

      const { transport, capturedRequests } = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        writeChunks: res => {
          res.end('<html><body>OK</body></html>');
        }
      }));
      CatalogDownloader.requestTransport = transport;

      const okRes = await CatalogDownloader.downloadCatalog('https://rebind-protect.example.ro/oferte', {
        maxRetries: 0
      });
      assert.strictEqual(okRes.ok, true);
      assert.strictEqual(lookupCalls, 1, 'DNS trebuie rezolvat o singură dată înaintea conexiunii fixate');
      assert.strictEqual(capturedRequests.length, 1);
      assert.strictEqual(capturedRequests[0].pinnedIp, '93.184.216.34');
      assert.strictEqual(capturedRequests[0].hostname, 'rebind-protect.example.ro');
      assert.strictEqual(capturedRequests[0].servername, 'rebind-protect.example.ro');

      // Test defensiv suplimentar: dacă socketul real se conectează la un IP privat (127.0.0.1) diferit de IP-ul DNS validat
      const localServer = await new Promise<http.Server>(resolve => {
        const s = http.createServer((_req, res) => {
          res.writeHead(200);
          res.end('SECRET_LOCAL_DATA');
        });
        s.listen(0, '127.0.0.1', () => resolve(s));
      });

      try {
        const localPort = (localServer.address() as AddressInfo).port;
        CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
        CatalogDownloader.requestTransport = {
          httpRequest: ((opts: any, cb: any) =>
            http.request({ ...opts, host: '127.0.0.1', hostname: '127.0.0.1', port: localPort, lookup: undefined }, cb)) as any,
          httpsRequest: origTransport.httpsRequest
        };

        const blockedMismatch = await CatalogDownloader.downloadCatalog(`http://rebind-protect.example.ro:${localPort}/`, {
          maxRetries: 0
        });
        assert.strictEqual(blockedMismatch.ok, false);
        assert.strictEqual(blockedMismatch.errorCode, 'SSRF_BLOCKED');
      } finally {
        await new Promise<void>(resolve => localServer.close(() => resolve()));
      }
    });

    it('procesează redirecționările manual și blochează redirect către rețea privată, localhost, metadata, file:// sau lanț excesiv', async () => {
      const testRedirectBlocking = async (redirectLocation: string) => {
        let hop2Attempted = false;
        CatalogDownloader.dnsLookup = async (host: string) => {
          if (host === 'public-start.example.ro') return [{ address: '93.184.216.34', family: 4 }];
          return [{ address: '10.0.0.1', family: 4 }];
        };
        const { transport } = createStreamTestTransport((reqInfo): MockServerReply => {
          if (reqInfo.hostname === 'public-start.example.ro') {
            return {
              statusCode: 302,
              headers: { location: redirectLocation },
              writeChunks: res => res.end()
            };
          }
          hop2Attempted = true;
          return {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            writeChunks: res => res.end('LEAKED')
          };
        });
        CatalogDownloader.requestTransport = transport;

        const res = await CatalogDownloader.downloadCatalog('https://public-start.example.ro/promo', {
          maxRetries: 0
        });
        assert.strictEqual(res.ok, false, `Redirecționarea către ${redirectLocation} trebuia blocată`);
        assert.strictEqual(res.errorCode, 'SSRF_BLOCKED');
        assert.strictEqual(hop2Attempted, false, `Nu trebuia inițiată nicio conexiune către ${redirectLocation}`);
      };

      await testRedirectBlocking('http://192.168.1.10/admin');
      await testRedirectBlocking('http://localhost:3000/api/admin/stats');
      await testRedirectBlocking('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
      await testRedirectBlocking('file:///etc/hosts');
      await testRedirectBlocking('https://internal-resolves-private.example.ro/secret');

      // Redirect chain valid vs depășirea maxRedirects
      let hopCount = 0;
      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      const { transport } = createStreamTestTransport((reqInfo): MockServerReply => {
        hopCount++;
        if (reqInfo.path === '/final') {
          return {
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            writeChunks: res => res.end('<h1>Catalog</h1>')
          };
        }
        return {
          statusCode: 301,
          headers: { location: `https://public-hop.example.ro/step-${hopCount + 1}` },
          writeChunks: res => res.end()
        };
      });
      CatalogDownloader.requestTransport = transport;

      const tooMany = await CatalogDownloader.downloadCatalog('https://public-hop.example.ro/step-1', {
        maxRedirects: 3,
        maxRetries: 0
      });
      assert.strictEqual(tooMany.ok, false);
      assert.strictEqual(tooMany.errorCode, 'TOO_MANY_REDIRECTS');
      assert.strictEqual(hopCount, 4); // initial + 3 redirects -> 4th redirect rejected
    });
  });

  // =========================================================================
  // 2. P2 – Streaming Download Size Limits, Gzip Bombs & Timeouts
  // =========================================================================
  describe('P2 – Streaming Size Limits, Decompression & Timeout Enforcement', () => {
    it('respinge imediat Content-Length > maxBytes înainte de citirea corpului', async () => {
      let bodyPushed = false;
      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      const { transport } = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': '2048'
        },
        writeChunks: (res, aborted) => {
          setTimeout(() => {
            if (!aborted()) {
              bodyPushed = true;
              res.end(Buffer.alloc(2048, 0x41));
            }
          }, 20);
        }
      }));
      CatalogDownloader.requestTransport = transport;

      const res = await CatalogDownloader.downloadCatalog('https://cdn.example.ro/big.pdf', {
        maxBytes: 1024,
        maxRetries: 0
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.errorCode, 'SIZE_EXCEEDED');
      assert.strictEqual(bodyPushed, false);
    });

    it('oprește streaming-ul imediat când lipsește Content-Length și totalul depășește maxBytes', async () => {
      let totalChunksSent = 0;
      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      const { transport } = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' }, // fără Content-Length
        writeChunks: (res, aborted) => {
          const interval = setInterval(() => {
            if (aborted() || totalChunksSent >= 50) {
              clearInterval(interval);
              if (!aborted()) res.end();
              return;
            }
            totalChunksSent++;
            res.write(Buffer.alloc(512, 0x61));
          }, 5);
        }
      }));
      CatalogDownloader.requestTransport = transport;

      const res = await CatalogDownloader.downloadCatalog('https://cdn.example.ro/stream.html', {
        maxBytes: 1024,
        maxRetries: 0
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.errorCode, 'SIZE_EXCEEDED');
      assert.ok(totalChunksSent < 10, `Trebuia oprit devreme din streaming, s-au trimis ${totalChunksSent} chunk-uri`);
    });

    it('blochează bombe de decompresie gzip când conținutul decompresat depășește maxBytes', async () => {
      const uncompressedLarge = Buffer.alloc(100 * 1024, 0x41); // 100 KB
      const compressedSmall = zlib.gzipSync(uncompressedLarge); // ~300 bytes compresat
      assert.ok(compressedSmall.length < 1024);

      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      const { transport } = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
          'content-length': String(compressedSmall.length)
        },
        writeChunks: res => res.end(compressedSmall)
      }));
      CatalogDownloader.requestTransport = transport;

      const res = await CatalogDownloader.downloadCatalog('https://cdn.example.ro/bomb.html', {
        maxBytes: 4096,
        maxRetries: 0
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.errorCode, 'SIZE_EXCEEDED');
    });

    it('menține timeout-ul activ pe durata streaming-ului și respinge fluxurile lente sau întrerupte', async () => {
      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

      // 1) Flux lent care trimite antetele imediat dar blochează corpul > timeoutMs
      const slow = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        writeChunks: (res, aborted) => {
          res.write('<html>partial');
          setTimeout(() => {
            if (!aborted()) res.end('</html>');
          }, 500);
        }
      }));
      CatalogDownloader.requestTransport = slow.transport;

      const slowRes = await CatalogDownloader.downloadCatalog('https://cdn.example.ro/slow.html', {
        timeoutMs: 80,
        maxRetries: 0
      });
      assert.strictEqual(slowRes.ok, false);
      assert.strictEqual(slowRes.errorCode, 'TIMEOUT');

      // 2) Flux întrerupt prematur (aborted fără end)
      const abortedStream = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        writeChunks: res => {
          res.write('<html>incomplet');
          setTimeout(() => {
            res.emit('aborted');
            res.destroy();
          }, 15);
        }
      }));
      CatalogDownloader.requestTransport = abortedStream.transport;

      const incRes = await CatalogDownloader.downloadCatalog('https://cdn.example.ro/broken.html', {
        timeoutMs: 1000,
        maxRetries: 0
      });
      assert.strictEqual(incRes.ok, false);
      assert.strictEqual(incRes.errorCode, 'INCOMPLETE_STREAM');

      // 3) Document valid sub limită (inclusiv gzip)
      const validPayload = Buffer.from('<html><body>Catalog Lidl</body></html>', 'utf-8');
      const gzValid = zlib.gzipSync(validPayload);
      const validTransport = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip'
        },
        writeChunks: res => res.end(gzValid)
      }));
      CatalogDownloader.requestTransport = validTransport.transport;

      const okRes = await CatalogDownloader.downloadCatalog('https://www.lidl.ro/oferte', {
        maxBytes: 1024 * 1024,
        maxRetries: 0
      });
      assert.strictEqual(okRes.ok, true);
      assert.strictEqual(okRes.text, validPayload.toString('utf-8'));
      assert.strictEqual(okRes.sha256, crypto.createHash('sha256').update(validPayload).digest('hex'));
    });
  });

  // =========================================================================
  // 3. P2 – Image URL Security Policy & /api/images/proxy
  // =========================================================================
  describe('P2 – Image URL Security & Server Proxy (/api/images/proxy)', () => {
    let appServer: http.Server;
    let appBaseUrl = '';

    before(async () => {
      const mod = await import('../server.ts');
      appServer = await new Promise<http.Server>(resolve => {
        const srv = mod.app.listen(0, '127.0.0.1', () => resolve(srv));
      });
      appBaseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
    });

    after(async () => {
      await new Promise<void>(resolve => appServer.close(() => resolve()));
    });

    it('filtrează URL-urile periculoase în parser și în getSafeProductImageSrc, păstrând rutele sigure', () => {
      const maliciousHtml = `
        <div class="product-card"><img src="javascript:alert(1)" /><h3>Produs JS 100g</h3><span class="current-price">5.00 lei</span></div>
        <div class="product-card"><img src="data:text/html,<script>alert(1)</script>" /><h3>Produs DataHTML 100g</h3><span class="current-price">6.00 lei</span></div>
        <div class="product-card"><img src="file:///etc/passwd" /><h3>Produs File 100g</h3><span class="current-price">7.00 lei</span></div>
        <div class="product-card"><img src="http://localhost:3000/img.png" /><h3>Produs Localhost 100g</h3><span class="current-price">8.00 lei</span></div>
        <div class="product-card"><img src="http://192.168.1.5/cam.jpg" /><h3>Produs PrivateIP 100g</h3><span class="current-price">9.00 lei</span></div>
        <div class="product-card"><img src="https://www.profi.ro/vector.svg" /><h3>Produs SVG 100g</h3><span class="current-price">9.50 lei</span></div>
        <div class="product-card"><img src="https://www.profi.ro/img/ok.webp" /><h3>Produs Valid 100g</h3><span class="current-price">10.00 lei</span></div>
      `;
      const parsed = CatalogParserEngine.parseHtmlCatalog(maliciousHtml, 'profi', 'https://www.profi.ro/oferte');
      assert.strictEqual(parsed.offers.length, 7);
      for (let i = 0; i < 6; i++) {
        assert.strictEqual(parsed.offers[i].imageUrl, undefined, `Imaginea nesigură #${i} trebuia respinsă`);
      }
      assert.strictEqual(parsed.offers[6].imageUrl, 'https://www.profi.ro/img/ok.webp');

      // Validare helper frontend getSafeProductImageSrc
      assert.strictEqual(getSafeProductImageSrc('javascript:alert(1)'), null);
      assert.strictEqual(getSafeProductImageSrc('data:image/png;base64,AAAA'), null);
      assert.strictEqual(getSafeProductImageSrc('file:///etc/hosts'), null);
      assert.strictEqual(getSafeProductImageSrc('http://localhost:3000/test.png'), null);
      assert.strictEqual(getSafeProductImageSrc('http://10.0.0.1/test.png'), null);
      assert.strictEqual(getSafeProductImageSrc('https://www.lidl.ro/img/icon.svg'), null);

      assert.strictEqual(getSafeProductImageSrc('/assets/placeholder.png'), '/assets/placeholder.png');
      assert.strictEqual(
        getSafeProductImageSrc('https://bwanbgbimktluajvwzsj.supabase.co/storage/v1/object/public/products/lapte.png'),
        'https://bwanbgbimktluajvwzsj.supabase.co/storage/v1/object/public/products/lapte.png'
      );
      assert.strictEqual(
        getSafeProductImageSrc('https://www.lidl.ro/img/lapte.jpg'),
        '/api/images/proxy?url=https%3A%2F%2Fwww.lidl.ro%2Fimg%2Flapte.jpg'
      );
    });

    it('proxy-ul /api/images/proxy permite imagini raster valide și blochează SSRF, redirect privat, MIME invalid și payload supradimensionat', async () => {
      // 1) Localhost / IP privat blocate direct cu 400
      for (const badUrl of [
        'http://localhost:3000/logo.png',
        'http://127.0.0.1/logo.png',
        'http://169.254.169.254/latest/meta-data/',
        'javascript:alert(1)',
        'file:///etc/passwd'
      ]) {
        const res = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent(badUrl)}`);
        assert.strictEqual(res.status, 400, `Proxy trebuia să respingă cu 400 URL-ul ${badUrl}`);
      }

      // 2) Redirect către IP privat -> 403 SSRF_BLOCKED
      CatalogDownloader.dnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
      CatalogDownloader.requestTransport = createStreamTestTransport(() => ({
        statusCode: 302,
        headers: { location: 'http://192.168.0.1/secret.png' },
        writeChunks: res => res.end()
      })).transport;
      const redirRes = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent('https://img.example.ro/redir.png')}`);
      assert.strictEqual(redirRes.status, 403);

      // 3) MIME invalid (text/html sau image/svg+xml sau SVG mascat ca image/png) -> 415
      CatalogDownloader.requestTransport = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'image/svg+xml' },
        writeChunks: res => res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
      })).transport;
      const svgRes = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent('https://img.example.ro/evil.svg')}`);
      assert.strictEqual(svgRes.status, 415);

      CatalogDownloader.requestTransport = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        writeChunks: res => res.end('<svg onload="alert(1)"/>')
      })).transport;
      const disguisedSvgRes = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent('https://img.example.ro/fake.png')}`);
      assert.strictEqual(disguisedSvgRes.status, 415);

      // 4) Imagine prea mare (> 5MB) -> 413
      CatalogDownloader.requestTransport = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(CatalogDownloader.MAX_IMAGE_SIZE_BYTES + 1024)
        },
        writeChunks: res => res.end()
      })).transport;
      const tooBigRes = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent('https://img.example.ro/huge.png')}`);
      assert.strictEqual(tooBigRes.status, 413);

      // 5) Imagine raster validă (PNG) -> 200 + antete de securitate
      CatalogDownloader.requestTransport = createStreamTestTransport(() => ({
        statusCode: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(VALID_1X1_PNG.length)
        },
        writeChunks: res => res.end(VALID_1X1_PNG)
      })).transport;
      const validImgRes = await fetch(`${appBaseUrl}/api/images/proxy?url=${encodeURIComponent('https://img.example.ro/valid.png')}`);
      assert.strictEqual(validImgRes.status, 200);
      assert.strictEqual(validImgRes.headers.get('content-type')?.split(';')[0], 'image/png');
      assert.strictEqual(validImgRes.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(validImgRes.headers.get('content-security-policy')?.includes("default-src 'none'"));
      const returnedBytes = Buffer.from(await validImgRes.arrayBuffer());
      assert.deepStrictEqual(returnedBytes, VALID_1X1_PNG);
    });
  });

  // =========================================================================
  // 4. P2 – Persistență official_url în ambele scenarii (PostgreSQL Pool & Supabase fallback)
  // =========================================================================
  describe('P2 – Persistență official_url (Scenario A Pool & Scenario B Supabase Fallback)', () => {
    it('Scenario B (getPool() == null, Supabase fallback): salvează, actualizează, golește și verifică prin read-back official_url', async () => {
      const origFrom = supabase.from.bind(supabase);
      const storeRows: Record<string, any>[] = [];
      const sourceRows: Record<string, any>[] = [];
      let simulateMissingOfficialUrlDrop = false;

      const stubFrom = (table: string) => {
        const rows = table === 'stores' ? storeRows : sourceRows;
        let op = 'select';
        let payload: any = null;
        const preds: Array<(r: any) => boolean> = [];

        const exec = async () => {
          if (op === 'insert') {
            const copy = { ...payload };
            if (simulateMissingOfficialUrlDrop && table === 'stores') {
              // Simulează un bug unde coloana official_url este ignorată la salvare
              copy.official_url = null;
            }
            rows.push(copy);
            return { data: [copy], error: null };
          }
          if (op === 'upsert') {
            const idx = rows.findIndex(r => r.id === payload.id);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
            else rows.push({ ...payload });
            return { data: [payload], error: null };
          }
          if (op === 'update') {
            const updated: any[] = [];
            for (let i = 0; i < rows.length; i++) {
              if (preds.every(fn => fn(rows[i]))) {
                rows[i] = { ...rows[i], ...payload };
                updated.push({ ...rows[i] });
              }
            }
            return { data: updated, error: null };
          }
          if (op === 'delete') {
            const toRemove = new Set(rows.filter(r => preds.every(fn => fn(r))));
            const remaining = rows.filter(r => !toRemove.has(r));
            rows.length = 0;
            rows.push(...remaining);
            return { data: Array.from(toRemove), error: null };
          }
          return { data: rows.filter(r => preds.every(fn => fn(r))).map(r => ({ ...r })), error: null };
        };

        const b: any = {
          select: () => b,
          insert: (d: any) => { op = 'insert'; payload = d; return b; },
          upsert: (d: any) => { op = 'upsert'; payload = d; return b; },
          update: (d: any) => { op = 'update'; payload = d; return b; },
          delete: () => { op = 'delete'; return b; },
          eq: (c: string, v: any) => { preds.push(r => r[c] === v); return b; },
          order: () => b,
          single: async () => {
            const r = await exec();
            return { data: r.data[0] || null, error: r.error };
          },
          maybeSingle: async () => {
            const r = await exec();
            return { data: r.data[0] || null, error: r.error };
          },
          then: (resFn: any, rejFn: any) => exec().then(resFn, rejFn)
        };
        return b;
      };

      (supabase as any).from = stubFrom;
      const mod = await import('../server.ts');
      const srv = await new Promise<http.Server>(resolve => {
        const s = mod.app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const headers = { Authorization: `Bearer ${mod.ADMIN_API_KEY}`, 'Content-Type': 'application/json' };

      try {
        const id = `sb-test-${Date.now()}`;
        const createRes = await fetch(`${base}/api/admin/retailers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id,
            name: 'Supabase Test Retailer',
            storeType: 'supermarket',
            color: 'emerald',
            officialUrl: 'https://www.dianamarket.ro/oferte'
          })
        });
        assert.strictEqual(createRes.status, 200);
        const created = await createRes.json();
        assert.strictEqual(created.retailer.officialUrl, 'https://www.dianamarket.ro/oferte');
        assert.strictEqual(storeRows[0].official_url, 'https://www.dianamarket.ro/oferte');

        // Actualizare official_url și verificare reload / read-back
        const putRes = await fetch(`${base}/api/admin/retailers/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: 'Supabase Test Retailer 2',
            chain: 'Diana',
            storeType: 'supermarket',
            color: 'blue',
            officialUrl: 'https://www.dianamarket.ro/cataloage'
          })
        });
        assert.strictEqual(putRes.status, 200);
        assert.strictEqual(storeRows[0].official_url, 'https://www.dianamarket.ro/cataloage');

        // Golire official_url ("" -> null în DB)
        const clearRes = await fetch(`${base}/api/admin/retailers/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: 'Supabase Test Retailer 2',
            chain: 'Diana',
            storeType: 'supermarket',
            color: 'blue',
            officialUrl: ''
          })
        });
        assert.strictEqual(clearRes.status, 200);
        assert.strictEqual(storeRows[0].official_url, null);

        // Dacă persistența official_url eșuează silențios la DB, endpointul TREBUIE să returneze eroare 500
        simulateMissingOfficialUrlDrop = true;
        const failRes = await fetch(`${base}/api/admin/retailers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: `${id}-fail`,
            name: 'Fail Verification',
            storeType: 'supermarket',
            color: 'emerald',
            officialUrl: 'https://www.exemplu.ro/oferte'
          })
        });
        assert.strictEqual(failRes.status, 500);
      } finally {
        (supabase as any).from = origFrom;
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    });

    it('Scenario A (getPool() configurat, PostgreSQL Pool): salvează, actualizează și verifică official_url prin read-back', async () => {
      const origPool = global._postgresPool;
      const origDbUrl = process.env.DATABASE_URL;
      const pgStoreRows: Record<string, any>[] = [];
      const pgSourceRows: Record<string, any>[] = [];

      const mockPool: any = {
        query: async (sql: string, params: any[] = []) => {
          const normalized = sql.replace(/\s+/g, ' ').trim();
          if (normalized.startsWith('INSERT INTO stores')) {
            const row = {
              id: params[0],
              name: params[1],
              slug: params[2],
              chain: params[3],
              brand_color: params[4],
              accent_color: params[5],
              official_url: params[6],
              store_type: params[7],
              rating: params[8],
              locations_count: params[9],
              sample_address: params[10],
              is_partner: params[11]
            };
            pgStoreRows.push(row);
            return { rows: [row] };
          }
          if (normalized.startsWith('UPDATE stores SET') && normalized.includes('official_url = $6')) {
            const target = pgStoreRows.find(r => r.id === params[6]);
            if (!target) return { rows: [] };
            Object.assign(target, {
              name: params[0],
              chain: params[1],
              brand_color: params[2],
              accent_color: params[3],
              store_type: params[4],
              official_url: params[5]
            });
            return { rows: [target] };
          }
          if (normalized.startsWith('SELECT id, name, slug, chain, brand_color, accent_color, store_type, official_url FROM stores WHERE id = $1')) {
            const target = pgStoreRows.find(r => r.id === params[0]);
            return { rows: target ? [{ ...target }] : [] };
          }
          if (normalized.startsWith('INSERT INTO catalog_sources')) {
            pgSourceRows.push({ id: params[0], retailer_id: params[1], catalog_url: params[3] });
            return { rows: [] };
          }
          return { rows: [] };
        },
        on: () => {},
        end: async () => {}
      };

      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';
      global._postgresPool = mockPool;

      const mod = await import('../server.ts');
      const srv = await new Promise<http.Server>(resolve => {
        const s = mod.app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const headers = { Authorization: `Bearer ${mod.ADMIN_API_KEY}`, 'Content-Type': 'application/json' };

      try {
        const id = `pg-test-${Date.now()}`;
        const createRes = await fetch(`${base}/api/admin/retailers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id,
            name: 'Postgres Test Store',
            storeType: 'hypermarket',
            color: 'amber',
            officialUrl: 'https://www.unicarm.ro/promotii'
          })
        });
        assert.strictEqual(createRes.status, 200);
        const createdJson = await createRes.json();
        assert.strictEqual(createdJson.retailer.officialUrl, 'https://www.unicarm.ro/promotii');
        assert.strictEqual(pgStoreRows[0].official_url, 'https://www.unicarm.ro/promotii');

        const putRes = await fetch(`${base}/api/admin/retailers/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: 'Postgres Test Store Updated',
            chain: 'Unicarm',
            storeType: 'hypermarket',
            color: 'amber',
            officialUrl: 'https://www.unicarm.ro/oferte-noi'
          })
        });
        assert.strictEqual(putRes.status, 200);
        const updatedJson = await putRes.json();
        assert.strictEqual(updatedJson.retailer.officialUrl, 'https://www.unicarm.ro/oferte-noi');
        assert.strictEqual(pgStoreRows[0].official_url, 'https://www.unicarm.ro/oferte-noi');
      } finally {
        global._postgresPool = origPool;
        if (origDbUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = origDbUrl;
        await new Promise<void>(resolve => srv.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // 5. P3 – AdminAddRetailerModal: Validare URL strictă și asociere label/input
  // =========================================================================
  describe('P3 – AdminAddRetailerModal URL Validation & Accessibility', () => {
    it('validează strict HTTP/HTTPS public și asociază explicit label htmlFor/id în AdminAddRetailerModal.tsx', () => {
      const modalSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/AdminAddRetailerModal.tsx'),
        'utf-8'
      );

      // Verifică utilizarea validatorului comun validatePublicHttpUrl
      assert.ok(modalSource.includes('validatePublicHttpUrl'), 'Modalul trebuie să folosească validatePublicHttpUrl');

      // Verifică asocierea completă htmlFor / id pentru câmpurile de formular
      const requiredFieldIds = [
        'retailer-name',
        'retailer-id',
        'retailer-chain',
        'retailer-store-type',
        'retailer-official-url',
        'retailer-format',
        'retailer-default-status',
        'retailer-has-initial-source',
        'retailer-source-name',
        'retailer-catalog-url',
        'retailer-source-format'
      ];
      for (const fieldId of requiredFieldIds) {
        assert.ok(
          modalSource.includes(`htmlFor="${fieldId}"`) && modalSource.includes(`id="${fieldId}"`),
          `Lipsește asocierea accesibilă htmlFor/id pentru câmpul "${fieldId}"`
        );
      }

      // Verifică comportamentul efectiv al funcției de validare utilizate de modal
      for (const invalidUrl of [
        'javascript:alert(1)',
        'data:text/html,xss',
        'file:///etc/passwd',
        'http://localhost:3000/oferte',
        'http://127.0.0.1/oferte',
        'http://192.168.1.1/oferte'
      ]) {
        assert.strictEqual(
          validatePublicHttpUrl(invalidUrl).safe,
          false,
          `Modal validator trebuia să blocheze URL-ul: ${invalidUrl}`
        );
      }
      assert.strictEqual(validatePublicHttpUrl('https://www.selgros.ro/oferte').safe, true);
    });
  });
});
