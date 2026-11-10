// src/indexing/catalog/CatalogDownloader.ts
// Modul de descărcare securizată a cataloagelor publice cu protecție SSRF și calcul SHA-256

import crypto from 'crypto';

export interface DownloadResult {
  ok: boolean;
  statusCode?: number;
  data?: Buffer;
  text?: string;
  contentType?: string;
  sha256?: string;
  fileSizeBytes?: number;
  error?: string;
  isDuplicate?: boolean;
}

export class CatalogDownloader {
  public static readonly MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
  public static readonly DEFAULT_TIMEOUT_MS = 20000; // 20 secunde

  /**
   * Domenii oficiale permise pentru descărcare cataloage
   */
  public static readonly ALLOWED_HOST_DOMAINS = [
    'lidl.ro',
    'kaufland.ro',
    'carrefour.ro',
    'penny.ro',
    'auchan.ro',
    'auchan.vtexassets.com',
    'vtexassets.com',
    'profi.ro',
    'mega-image.ro',
    'metro.ro',
    'leaflet.lidl.ro',
    'cdn.lidl.ro',
    'media.kaufland.com',
    'assets.leaflets.schwarz',
    'leaflets.schwarz',
    'endpoints.leaflets.schwarz',
    'view.publitas.com',
    'publitas.com',
    'files.rewe.co.at',
    'rewe.co.at',
    'carrefour-romania.ro'
  ];

  /**
   * Verifică dacă adresa URL este sigură împotriva atacurilor SSRF
   */
  static validateUrlSafety(inputUrl: string): { safe: boolean; reason?: string } {
    try {
      const parsed = new URL(inputUrl);

      // 1. Verificare protocol (doar http și https)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { safe: false, reason: `Protocol nepermis: ${parsed.protocol}. Sunt permise exclusiv http și https.` };
      }

      const hostname = parsed.hostname.toLowerCase();

      // 2. Protecție SSRF: Blocare localhost și adrese de buclă/interne
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local')
      ) {
        return { safe: false, reason: `Acces interzis la adrese locale sau interne: ${hostname}` };
      }

      // 3. Blocare intervale IP private (IPv4)
      const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipMatch) {
        const [_, a, b] = ipMatch.map(Number);
        // 10.0.0.0/8
        if (a === 10) return { safe: false, reason: 'Acces interzis la rețea privată (10.0.0.0/8).' };
        // 172.16.0.0/12
        if (a === 172 && b >= 16 && b <= 31) return { safe: false, reason: 'Acces interzis la rețea privată (172.16.0.0/12).' };
        // 192.168.0.0/16
        if (a === 192 && b === 168) return { safe: false, reason: 'Acces interzis la rețea privată (192.168.0.0/16).' };
        // 169.254.0.0/16 (Link-local / Cloud metadata)
        if (a === 169 && b === 254) return { safe: false, reason: 'Acces interzis la link-local / cloud metadata (169.254.0.0/16).' };
        // 127.0.0.0/8
        if (a === 127) return { safe: false, reason: 'Acces interzis la loopback (127.0.0.0/8).' };
      }

      // 4. Verificare dacă domeniul aparține retailerilor autorizați sau allowlist-ului
      const matchesAllowed = this.ALLOWED_HOST_DOMAINS.some(allowed => {
        return hostname === allowed || hostname.endsWith('.' + allowed);
      });

      if (!matchesAllowed) {
        return {
          safe: false,
          reason: `Domeniul ${hostname} nu se află în lista retailerilor oficiali autorizați pentru descărcare cataloage.`
        };
      }

      return { safe: true };
    } catch (err: any) {
      return { safe: false, reason: `URL malformat sau invalid: ${err.message}` };
    }
  }

  /**
   * Descarcă conținutul unui catalog public cu retry și backoff exponențial
   */
  static async downloadCatalog(
    url: string,
    options: {
      timeoutMs?: number;
      maxRetries?: number;
      knownChecksums?: Set<string>;
    } = {}
  ): Promise<DownloadResult> {
    const safety = this.validateUrlSafety(url);
    if (!safety.safe) {
      return { ok: false, error: safety.reason };
    }

    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? 2;

    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml,application/pdf,application/json,*/*;q=0.8',
            'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          lastError = `Răspuns HTTP necorespunzător: ${response.status} ${response.statusText}`;
          if (response.status >= 500 && attempt <= maxRetries) {
            // Retry pe server error
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
            continue;
          }
          return { ok: false, statusCode: response.status, error: lastError };
        }

        const contentLengthHeader = response.headers.get('content-length');
        if (contentLengthHeader && parseInt(contentLengthHeader, 10) > this.MAX_FILE_SIZE_BYTES) {
          return {
            ok: false,
            error: `Dimensiunea fișierului (${Math.round(parseInt(contentLengthHeader, 10) / 1024 / 1024)}MB) depășește limita permisă de ${Math.round(this.MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.`
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > this.MAX_FILE_SIZE_BYTES) {
          return {
            ok: false,
            error: `Fișier descărcat prea mare: ${Math.round(buffer.length / 1024 / 1024)}MB.`
          };
        }

        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

        // Verificare deduplicare
        if (options.knownChecksums && options.knownChecksums.has(sha256)) {
          return {
            ok: true,
            isDuplicate: true,
            statusCode: response.status,
            sha256,
            fileSizeBytes: buffer.length,
            contentType: response.headers.get('content-type') || 'application/octet-stream'
          };
        }

        const contentType = response.headers.get('content-type') || 'text/html';
        const text = buffer.toString('utf-8');

        return {
          ok: true,
          statusCode: response.status,
          data: buffer,
          text,
          contentType,
          sha256,
          fileSizeBytes: buffer.length,
          isDuplicate: false
        };
      } catch (err: any) {
        lastError = err.name === 'AbortError' ? `Timeout la descărcare după ${timeoutMs}ms.` : err.message;
        if (attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    return { ok: false, error: lastError || 'Descărcarea catalogului a eșuat după reîncercări.' };
  }
}
