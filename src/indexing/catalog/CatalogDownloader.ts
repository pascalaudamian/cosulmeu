// src/indexing/catalog/CatalogDownloader.ts
// Modul de descărcare securizată a cataloagelor și imaginilor publice cu protecție SSRF completă,
// DNS pinning anti-rebinding, redirecționări manuale și limitare reală în streaming

import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import {
  isPublicIpAddress,
  validatePublicHttpUrl,
  UrlSafetyResult
} from '../../utils/urlSecurity.js';

export interface DownloadResult {
  ok: boolean;
  statusCode?: number;
  data?: Buffer;
  text?: string;
  contentType?: string;
  finalUrl?: string;
  sha256?: string;
  fileSizeBytes?: number;
  error?: string;
  errorCode?: 'SSRF_BLOCKED' | 'SIZE_EXCEEDED' | 'TIMEOUT' | 'TOO_MANY_REDIRECTS' | 'INCOMPLETE_STREAM' | 'INVALID_MIME' | 'HTTP_ERROR' | 'NETWORK_ERROR';
  isDuplicate?: boolean;
}

export interface DnsResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface RequestTransport {
  httpRequest: typeof http.request;
  httpsRequest: typeof https.request;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

const ALLOWED_RASTER_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);

function isValidRasterImageBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;

  // Respinge explicit payload-uri text/SVG/HTML camuflate
  const headAscii = buf.subarray(0, Math.min(buf.length, 256)).toString('utf-8').trimStart().toLowerCase();
  if (
    headAscii.startsWith('<svg') ||
    headAscii.startsWith('<?xml') ||
    headAscii.startsWith('<!doctype') ||
    headAscii.startsWith('<html') ||
    headAscii.startsWith('<script')
  ) {
    return false;
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }
  // GIF87a / GIF89a
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return true;
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }
  // AVIF / ISOBMFF: ....ftyp(avif|avis|mif1)
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1' || brand === 'heic') {
      return true;
    }
  }

  return false;
}

export class CatalogDownloader {
  public static readonly MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
  public static readonly MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  public static readonly DEFAULT_TIMEOUT_MS = 20000; // 20 secunde
  public static readonly DEFAULT_MAX_REDIRECTS = 5;

  /**
   * Hook-uri injectabile strict pentru testare deterministă (DNS rebinding, streaming, redirecționări)
   * fără a relaxa vreodată regulile de validare IP/SSRF în producție.
   */
  public static dnsLookup: (hostname: string) => Promise<DnsResolvedAddress[]> = async (hostname: string) => {
    const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return results.map(r => ({
      address: r.address,
      family: r.family === 6 ? 6 : 4
    }));
  };

  public static requestTransport: RequestTransport = {
    httpRequest: ((...args: any[]) => (http.request as any)(...args)) as typeof http.request,
    httpsRequest: ((...args: any[]) => (https.request as any)(...args)) as typeof https.request
  };

  /**
   * Verifică URL-urile publice HTTP(S) și blochează hosturile locale, private și rezervate.
   */
  static validatePublicUrlSafety(inputUrl: string): UrlSafetyResult {
    return validatePublicHttpUrl(inputUrl);
  }

  /**
   * Compatibility wrapper for existing callers that pass legacy domain lists.
   * All public HTTP(S) domains are accepted; local, private, and reserved targets remain blocked.
   */
  static validateUrlSafety(inputUrl: string, _additionalAllowedDomains?: string[]): { safe: boolean; reason?: string } {
    const result = this.validatePublicUrlSafety(inputUrl);
    return result.safe ? { safe: true } : { safe: false, reason: result.reason };
  }

  /**
   * Rezolvă DNS și validează TOATE adresele IPv4/IPv6 returnate (blochează dacă cel puțin una este non-publică).
   */
  static async resolveAndValidatePublicHost(hostname: string): Promise<{
    ok: boolean;
    pinnedAddress?: DnsResolvedAddress;
    allAddresses?: DnsResolvedAddress[];
    reason?: string;
  }> {
    const normalized = (hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
    if (!normalized) {
      return { ok: false, reason: 'Hostname invalid sau gol.' };
    }

    const ipFamily = net.isIP(normalized);
    if (ipFamily === 4 || ipFamily === 6) {
      if (!isPublicIpAddress(normalized)) {
        return {
          ok: false,
          reason: `Acces interzis la adresa IP non-publică: ${normalized}`
        };
      }
      const addr: DnsResolvedAddress = { address: normalized, family: ipFamily };
      return { ok: true, pinnedAddress: addr, allAddresses: [addr] };
    }

    let resolved: DnsResolvedAddress[];
    try {
      resolved = await this.dnsLookup(normalized);
    } catch (err: any) {
      return {
        ok: false,
        reason: `Rezoluția DNS a eșuat pentru ${normalized}: ${err?.message || 'eroare DNS'}`
      };
    }

    if (!Array.isArray(resolved) || resolved.length === 0) {
      return {
        ok: false,
        reason: `DNS nu a returnat nicio adresă IP pentru ${normalized}.`
      };
    }

    for (const entry of resolved) {
      if (!entry?.address || !isPublicIpAddress(entry.address)) {
        return {
          ok: false,
          reason: `Acces interzis SSRF: domeniul ${normalized} s-a rezolvat către o adresă IP locală, privată sau rezervată (${entry?.address || 'necunoscută'}).`
        };
      }
    }

    return {
      ok: true,
      pinnedAddress: resolved[0],
      allAddresses: resolved
    };
  }

  private static async executeSinglePinnedRequest(
    targetUrl: string,
    options: {
      maxBytes: number;
      signal: AbortSignal;
      acceptHeader: string;
    }
  ): Promise<{
    kind: 'redirect';
    statusCode: number;
    location: string;
    currentUrl: string;
  } | {
    kind: 'response';
    statusCode: number;
    statusMessage: string;
    contentType: string;
    finalUrl: string;
    data: Buffer;
  }> {
    const urlSafety = this.validatePublicUrlSafety(targetUrl);
    if (!urlSafety.safe || !urlSafety.normalizedUrl || !urlSafety.hostname) {
      const err = new Error(urlSafety.reason || 'URL nesigur blocat de protecția SSRF.');
      (err as any).errorCode = 'SSRF_BLOCKED';
      throw err;
    }

    const parsedUrl = new URL(urlSafety.normalizedUrl);
    const dnsCheck = await this.resolveAndValidatePublicHost(urlSafety.hostname);
    if (!dnsCheck.ok || !dnsCheck.pinnedAddress) {
      const err = new Error(dnsCheck.reason || 'Destinație blocată de validarea DNS SSRF.');
      (err as any).errorCode = 'SSRF_BLOCKED';
      throw err;
    }

    const pinned = dnsCheck.pinnedAddress;
    const isHttps = parsedUrl.protocol === 'https:';
    const requestFn = isHttps ? this.requestTransport.httpsRequest : this.requestTransport.httpRequest;

    // Lookup fixat strict pe adresa IP deja validată -> previne DNS rebinding TOCTOU
    const pinnedLookup = (
      _hostname: string,
      lookupOpts: any,
      callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
    ) => {
      process.nextTick(() => {
        if (lookupOpts && lookupOpts.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          callback(null, pinned.address, pinned.family);
        }
      });
    };

    return await new Promise((resolve, reject) => {
      if (options.signal.aborted) {
        const abortErr = new Error('Cererea a fost întreruptă din cauza timeout-ului.');
        (abortErr as any).errorCode = 'TIMEOUT';
        reject(abortErr);
        return;
      }

      let settled = false;
      let activeReq: http.ClientRequest | null = null;
      let activeRes: http.IncomingMessage | null = null;
      let activeDecompressor: Transform | null = null;

      const noopError = () => {};

      const cleanup = () => {
        options.signal.removeEventListener('abort', onAbort);
        if (activeDecompressor) {
          activeDecompressor.removeAllListeners();
          activeDecompressor.on('error', noopError);
          if (!activeDecompressor.destroyed) activeDecompressor.destroy();
          activeDecompressor = null;
        }
        if (activeRes) {
          activeRes.removeAllListeners();
          activeRes.on('error', noopError);
          if (!activeRes.destroyed) activeRes.destroy();
          activeRes = null;
        }
        if (activeReq) {
          activeReq.removeAllListeners('socket');
          activeReq.removeAllListeners('error');
          activeReq.on('error', noopError);
        }
      };

      const fail = (err: Error, code?: DownloadResult['errorCode']) => {
        if (settled) return;
        settled = true;
        if (code && !(err as any).errorCode) {
          (err as any).errorCode = code;
        }
        cleanup();
        if (activeReq && !activeReq.destroyed) {
          activeReq.destroy();
        }
        reject(err);
      };

      const onAbort = () => {
        const reason = options.signal.reason;
        const err = reason instanceof Error ? reason : new Error('Timeout la descărcare.');
        fail(err, (err as any).errorCode || 'TIMEOUT');
      };

      options.signal.addEventListener('abort', onAbort, { once: true });

      const requestOptions: https.RequestOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        lookup: pinnedLookup as any,
        ...(isHttps && net.isIP(urlSafety.hostname!) === 0 ? { servername: urlSafety.hostname } : {}),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': options.acceptHeader,
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        }
      };

      try {
        activeReq = requestFn(requestOptions, res => {
          activeRes = res;
          const statusCode = res.statusCode || 0;
          const statusMessage = res.statusMessage || '';

          // 1. Verificare socket remoteAddress și la recepția răspunsului (apărare în adâncime)
          const sock = res.socket || activeReq?.socket;
          if (sock?.remoteAddress) {
            const normRemote = sock.remoteAddress.replace(/^::ffff:/i, '');
            const normPinned = pinned.address.replace(/^::ffff:/i, '');
            if (!isPublicIpAddress(sock.remoteAddress) || normRemote !== normPinned) {
              const ssrfErr = new Error(
                `Conexiune blocată SSRF: adresa socketului (${sock.remoteAddress}) nu corespunde IP-ului validat (${pinned.address}).`
              );
              fail(ssrfErr, 'SSRF_BLOCKED');
              return;
            }
          }

          // 2. Gestionare manuală a redirecționărilor (fără auto-follow)
          if (REDIRECT_STATUS_CODES.has(statusCode)) {
            const rawLocation = res.headers.location;
            const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
            if (!settled) {
              settled = true;
              cleanup();
              if (!location || !location.trim()) {
                const redirErr = new Error(`Redirecționare HTTP ${statusCode} fără antet Location.`);
                (redirErr as any).errorCode = 'HTTP_ERROR';
                reject(redirErr);
                return;
              }
              resolve({
                kind: 'redirect',
                statusCode,
                location: location.trim(),
                currentUrl: parsedUrl.href
              });
            }
            return;
          }

          // 3. Verificare preliminară Content-Length (nu ne bazăm exclusiv pe el)
          const rawContentLength = res.headers['content-length'];
          if (rawContentLength !== undefined) {
            const lengthStr = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength;
            const declaredBytes = Number.parseInt(lengthStr, 10);
            if (Number.isFinite(declaredBytes) && declaredBytes > options.maxBytes) {
              const sizeErr = new Error(
                `Dimensiunea declarată (${declaredBytes} bytes) depășește limita maximă permisă de ${options.maxBytes} bytes.`
              );
              fail(sizeErr, 'SIZE_EXCEEDED');
              return;
            }
          }

          // 4. Citire incrementală în streaming + protecție împotriva bombelor de decompresie
          const contentEncoding = String(res.headers['content-encoding'] || '')
            .split(',')[0]
            .trim()
            .toLowerCase();

          let rawBytes = 0;
          let decodedBytes = 0;
          const chunks: Buffer[] = [];
          let resEnded = false;
          let endedCleanly = false;

          res.on('end', () => {
            resEnded = true;
          });

          res.on('data', (rawChunk: Buffer) => {
            rawBytes += rawChunk.length;
            if (rawBytes > options.maxBytes) {
              const sizeErr = new Error(
                `Fluxul descărcat (${rawBytes} bytes) a depășit limita maximă permisă de ${options.maxBytes} bytes.`
              );
              fail(sizeErr, 'SIZE_EXCEEDED');
            }
          });

          let outputStream: NodeJS.ReadableStream = res;
          if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
            activeDecompressor = zlib.createGunzip();
            outputStream = res.pipe(activeDecompressor);
          } else if (contentEncoding === 'deflate') {
            activeDecompressor = zlib.createInflate();
            outputStream = res.pipe(activeDecompressor);
          } else if (contentEncoding === 'br') {
            activeDecompressor = zlib.createBrotliDecompress();
            outputStream = res.pipe(activeDecompressor);
          }

          outputStream.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            decodedBytes += bufChunk.length;
            if (decodedBytes > options.maxBytes) {
              const sizeErr = new Error(
                `Conținutul decompresat (${decodedBytes} bytes) a depășit limita maximă permisă de ${options.maxBytes} bytes.`
              );
              fail(sizeErr, 'SIZE_EXCEEDED');
              return;
            }
            chunks.push(bufChunk);
          });

          outputStream.on('end', () => {
            if (settled) return;
            endedCleanly = true;
            settled = true;
            const data = Buffer.concat(chunks, decodedBytes);
            const rawCt = res.headers['content-type'];
            const contentType = Array.isArray(rawCt) ? rawCt[0] : (rawCt || 'application/octet-stream');
            cleanup();
            resolve({
              kind: 'response',
              statusCode,
              statusMessage,
              contentType,
              finalUrl: parsedUrl.href,
              data
            });
          });

          const onStreamError = (err: Error) => {
            if (settled) return;
            fail(new Error(`Eroare la citirea fluxului HTTP: ${err.message}`), 'NETWORK_ERROR');
          };

          const onAborted = () => {
            if (settled || endedCleanly) return;
            fail(
              new Error('Descărcarea a fost întreruptă înainte de finalizarea fluxului HTTP.'),
              'INCOMPLETE_STREAM'
            );
          };

          const onResClose = () => {
            if (settled || endedCleanly || resEnded) return;
            fail(
              new Error('Descărcarea a fost întreruptă înainte de finalizarea fluxului HTTP.'),
              'INCOMPLETE_STREAM'
            );
          };

          const onDecompressorClose = () => {
            if (settled || endedCleanly) return;
            fail(
              new Error('Decompresia fluxului HTTP s-a închis prematur.'),
              'INCOMPLETE_STREAM'
            );
          };

          res.on('error', onStreamError);
          res.on('aborted', onAborted);
          res.on('close', onResClose);
          if (activeDecompressor) {
            activeDecompressor.on('error', err => {
              if (settled) return;
              fail(new Error(`Eroare de decompresie conținut (${contentEncoding}): ${err.message}`), 'NETWORK_ERROR');
            });
            activeDecompressor.on('close', onDecompressorClose);
          }
        });

        activeReq.on('socket', socket => {
          const verifyConnectedSocket = () => {
            const remote = socket.remoteAddress;
            if (!remote) return;
            const normRemote = remote.replace(/^::ffff:/i, '');
            const normPinned = pinned.address.replace(/^::ffff:/i, '');
            if (!isPublicIpAddress(remote) || normRemote !== normPinned) {
              const ssrfErr = new Error(
                `Conexiune blocată SSRF: socketul s-a conectat la o adresă nevalidată (${remote} != ${pinned.address}).`
              );
              fail(ssrfErr, 'SSRF_BLOCKED');
            }
          };

          if (socket.remoteAddress) {
            verifyConnectedSocket();
          } else {
            socket.once('connect', verifyConnectedSocket);
          }
        });

        activeReq.on('error', err => {
          if (settled) return;
          fail(err, (err as any).errorCode || 'NETWORK_ERROR');
        });

        activeReq.end();
      } catch (err: any) {
        fail(err instanceof Error ? err : new Error(String(err)), err?.errorCode || 'NETWORK_ERROR');
      }
    });
  }

  /**
   * Descarcă conținutul unui catalog public cu protecție SSRF completă, redirecționări manuale,
   * limitare în streaming și retry cu backoff exponențial pentru erori tranzitorii.
   */
  static async downloadCatalog(
    url: string,
    options: {
      timeoutMs?: number;
      maxRetries?: number;
      maxRedirects?: number;
      maxBytes?: number;
      knownChecksums?: Set<string>;
      additionalAllowedDomains?: string[];
      acceptHeader?: string;
    } = {}
  ): Promise<DownloadResult> {
    const initialSafety = this.validateUrlSafety(url, options.additionalAllowedDomains);
    if (!initialSafety.safe) {
      return { ok: false, errorCode: 'SSRF_BLOCKED', error: initialSafety.reason };
    }

    const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? 2;
    const maxRedirects = options.maxRedirects ?? this.DEFAULT_MAX_REDIRECTS;
    const maxBytes = options.maxBytes ?? this.MAX_FILE_SIZE_BYTES;
    const acceptHeader =
      options.acceptHeader ||
      'text/html,application/xhtml+xml,application/xml,application/pdf,application/json,*/*;q=0.8';

    let lastError = '';
    let lastErrorCode: DownloadResult['errorCode'] = 'NETWORK_ERROR';

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        const timeoutErr = new Error(`Timeout la descărcare după ${timeoutMs}ms.`);
        (timeoutErr as any).errorCode = 'TIMEOUT';
        controller.abort(timeoutErr);
      }, timeoutMs);

      try {
        let currentUrl = url;
        let redirectCount = 0;

        while (true) {
          const stepResult = await this.executeSinglePinnedRequest(currentUrl, {
            maxBytes,
            signal: controller.signal,
            acceptHeader
          });

          if (stepResult.kind === 'redirect') {
            if (redirectCount >= maxRedirects) {
              return {
                ok: false,
                statusCode: stepResult.statusCode,
                finalUrl: currentUrl,
                errorCode: 'TOO_MANY_REDIRECTS',
                error: `Număr maxim de redirecționări depășit (${maxRedirects}).`
              };
            }

            let resolvedNext: URL;
            try {
              resolvedNext = new URL(stepResult.location, stepResult.currentUrl);
            } catch {
              return {
                ok: false,
                statusCode: stepResult.statusCode,
                finalUrl: currentUrl,
                errorCode: 'SSRF_BLOCKED',
                error: 'URL de redirecționare malformat sau invalid.'
              };
            }

            const redirectSafety = this.validatePublicUrlSafety(resolvedNext.href);
            if (!redirectSafety.safe) {
              return {
                ok: false,
                statusCode: stepResult.statusCode,
                finalUrl: currentUrl,
                errorCode: 'SSRF_BLOCKED',
                error: `Redirecționare blocată SSRF: ${redirectSafety.reason}`
              };
            }

            currentUrl = resolvedNext.href;
            redirectCount++;
            continue;
          }

          // Răspuns final non-redirect
          if (stepResult.statusCode < 200 || stepResult.statusCode >= 300) {
            lastError = `Răspuns HTTP necorespunzător: ${stepResult.statusCode} ${stepResult.statusMessage}`.trim();
            lastErrorCode = 'HTTP_ERROR';
            if (stepResult.statusCode >= 500 && attempt <= maxRetries) {
              break; // retry
            }
            return {
              ok: false,
              statusCode: stepResult.statusCode,
              finalUrl: stepResult.finalUrl,
              errorCode: 'HTTP_ERROR',
              error: lastError
            };
          }

          const buffer = stepResult.data;
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

          if (options.knownChecksums && options.knownChecksums.has(sha256)) {
            return {
              ok: true,
              isDuplicate: true,
              statusCode: stepResult.statusCode,
              finalUrl: stepResult.finalUrl,
              sha256,
              fileSizeBytes: buffer.length,
              contentType: stepResult.contentType
            };
          }

          return {
            ok: true,
            statusCode: stepResult.statusCode,
            finalUrl: stepResult.finalUrl,
            data: buffer,
            text: buffer.toString('utf-8'),
            contentType: stepResult.contentType,
            sha256,
            fileSizeBytes: buffer.length,
            isDuplicate: false
          };
        }
      } catch (err: any) {
        const code: DownloadResult['errorCode'] = err?.errorCode || (err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        lastErrorCode = code;
        lastError = code === 'TIMEOUT'
          ? `Timeout la descărcare după ${timeoutMs}ms.`
          : (err?.message || 'Eroare de rețea la descărcare.');

        // Erorile de securitate (SSRF) sau limită de dimensiune nu se reîncearcă
        if (code === 'SSRF_BLOCKED' || code === 'SIZE_EXCEEDED' || code === 'TOO_MANY_REDIRECTS') {
          return { ok: false, errorCode: code, error: lastError };
        }
      } finally {
        clearTimeout(timeoutId);
      }

      if (attempt <= maxRetries) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 400));
      }
    }

    return {
      ok: false,
      errorCode: lastErrorCode,
      error: lastError || 'Descărcarea catalogului a eșuat după reîncercări.'
    };
  }

  /**
   * Descarcă o imagine externă în siguranță pentru proxy-ul server-side:
   * - protecție SSRF completă + redirecționări manuale (max 3)
   * - limită strictă de dimensiune în streaming (implicit 5 MB)
   * - validare strictă MIME type raster (exclude image/svg+xml și payloads non-imagine) + semnătură binară
   */
  static async downloadImageSafely(
    url: string,
    options: {
      timeoutMs?: number;
      maxBytes?: number;
      maxRedirects?: number;
    } = {}
  ): Promise<DownloadResult> {
    const result = await this.downloadCatalog(url, {
      timeoutMs: options.timeoutMs ?? 10000,
      maxRetries: 0,
      maxRedirects: options.maxRedirects ?? 3,
      maxBytes: options.maxBytes ?? this.MAX_IMAGE_SIZE_BYTES,
      acceptHeader: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9'
    });

    if (!result.ok || !result.data) {
      return result;
    }

    const baseMime = (result.contentType || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_RASTER_IMAGE_MIMES.has(baseMime)) {
      return {
        ok: false,
        statusCode: result.statusCode,
        finalUrl: result.finalUrl,
        errorCode: 'INVALID_MIME',
        error: `Tip MIME imagine nepermis sau nesigur: ${baseMime || 'necunoscut'}.`
      };
    }

    if (!isValidRasterImageBuffer(result.data)) {
      return {
        ok: false,
        statusCode: result.statusCode,
        finalUrl: result.finalUrl,
        errorCode: 'INVALID_MIME',
        error: 'Conținutul descărcat nu corespunde unei imagini raster valide.'
      };
    }

    const normalizedMime = baseMime === 'image/jpg' ? 'image/jpeg' : baseMime;
    return {
      ...result,
      contentType: normalizedMime
    };
  }
}
