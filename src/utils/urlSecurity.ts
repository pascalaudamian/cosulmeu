// src/utils/urlSecurity.ts
// Validare strictă URL-uri publice HTTP/HTTPS, protecție SSRF IPv4/IPv6 și helper sigur pentru imagini

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  hostname?: string;
  normalizedUrl?: string;
}

const RESERVED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.default',
  'kubernetes.default.svc'
]);

const RESERVED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.home'
];

export function isPublicIpv4Octets(octets: [number, number, number, number]): boolean {
  const [a, b, c, d] = octets;
  if ([a, b, c, d].some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }

  // Rețele non-publice, loopback, private, link-local, CGNAT, test, multicast, rezervate
  if (a === 0) return false; // 0.0.0.0/8 ("this" network)
  if (a === 10) return false; // 10.0.0.0/8 (RFC 1918)
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (RFC 6598 CGNAT)
  if (a === 127) return false; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 (link-local & cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 (RFC 1918)
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 88 && c === 99) return false; // 192.88.99.0/24 (6to4 relay anycast)
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 (RFC 1918)
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255

  return true;
}

function parseIpv4Part(part: string): number | null {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const val = Number.parseInt(part, 16);
    return Number.isFinite(val) ? val : null;
  }
  if (/^0[0-7]+$/.test(part)) {
    const val = Number.parseInt(part, 8);
    return Number.isFinite(val) ? val : null;
  }
  if (/^\d+$/.test(part)) {
    const val = Number.parseInt(part, 10);
    return Number.isFinite(val) ? val : null;
  }
  return null;
}

/**
 * Parsează atât IPv4 standard (a.b.c.d) cât și notații alternative (hex, octal, integer, shorthand)
 */
export function parseIpv4Alternative(host: string): [number, number, number, number] | null {
  const clean = host.trim().replace(/\.+$/, '');
  if (!clean) return null;
  const parts = clean.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    const val = parseIpv4Part(part);
    if (val === null || val < 0) return null;
    nums.push(val);
  }

  if (nums.length === 1) {
    const n = nums[0];
    if (n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  if (nums.length === 2) {
    const [a, rest] = nums;
    if (a > 0xff || rest > 0xffffff) return null;
    return [a, (rest >>> 16) & 0xff, (rest >>> 8) & 0xff, rest & 0xff];
  }
  if (nums.length === 3) {
    const [a, b, rest] = nums;
    if (a > 0xff || b > 0xff || rest > 0xffff) return null;
    return [a, b, (rest >>> 8) & 0xff, rest & 0xff];
  }

  if (nums.some(n => n > 0xff)) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

export function parseIpv6Hextets(rawIp: string): number[] | null {
  let ip = rawIp.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!ip || ip.includes('%')) {
    return null;
  }

  // Suport IPv4 încorporat la finalul IPv6 (ex: ::ffff:127.0.0.1 sau 64:ff9b::127.0.0.1)
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4Part = ip.slice(lastColon + 1);
    const v4Match = ipv4Part.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4Match) return null;
    const octets = v4Match.slice(1).map(Number);
    if (octets.some(o => o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (!segment) return [];
    const groups = segment.split(':');
    const result: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      result.push(Number.parseInt(g, 16));
    }
    return result;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseGroups(doubleColonParts[0]);
    if (!groups || groups.length !== 8) return null;
    return groups;
  }

  const left = parseGroups(doubleColonParts[0]);
  const right = parseGroups(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

export function isPublicIpv6Hextets(h: number[]): boolean {
  if (h.length !== 8) return false;

  // ::/128 (unspecified) și ::1/128 (loopback)
  const firstSevenZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0;
  if (firstSevenZero && (h[7] === 0 || h[7] === 1)) {
    return false;
  }

  // ::ffff:0:0/96 (IPv4-mapped IPv6) -> verifică IPv4 încorporat
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const octets: [number, number, number, number] = [
      (h[6] >>> 8) & 0xff,
      h[6] & 0xff,
      (h[7] >>> 8) & 0xff,
      h[7] & 0xff
    ];
    return isPublicIpv4Octets(octets);
  }

  // ::/96 (IPv4-compatible deprecated) și ::ffff:0:0:0/96 (IPv4-translated)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return false;
  }
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
    return false;
  }

  // 64:ff9b::/96 și 64:ff9b:1::/48 (NAT64 well-known / local-use)
  if (h[0] === 0x0064 && h[1] === 0xff9b && ((h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) || h[2] === 0x0001)) {
    return false;
  }

  // 100::/64 (Discard-Only)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    return false;
  }

  // fc00::/7 (Unique Local Addresses - ULA)
  if ((h[0] & 0xfe00) === 0xfc00) {
    return false;
  }

  // fe80::/10 (Link-Local) și fec0::/10 (Site-Local deprecated)
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) {
    return false;
  }

  // ff00::/8 (Multicast)
  if ((h[0] & 0xff00) === 0xff00) {
    return false;
  }

  // 2001::/32 (Teredo), 2001:2::/48 (Benchmarking), 2001:10::/28 (ORCHID), 2001:20::/28 (ORCHIDv2), 2001:db8::/32 (Documentation)
  if (h[0] === 0x2001) {
    if (h[1] === 0x0000) return false;
    if (h[1] === 0x0002 && h[2] === 0x0000) return false;
    if ((h[1] & 0xfff0) === 0x0010 || (h[1] & 0xfff0) === 0x0020) return false;
    if (h[1] === 0x0db8) return false;
  }

  // 2002::/16 (6to4 tunneling)
  if (h[0] === 0x2002) {
    return false;
  }

  // Permite exclusiv adrese Global Unicast (2000::/3) în afara blocurilor rezervate de mai sus
  if ((h[0] & 0xe000) !== 0x2000) {
    return false;
  }

  return true;
}

export function isPublicIpAddress(rawIp: string): boolean {
  const cleaned = (rawIp || '').trim().replace(/^\[|\]$/g, '');
  if (!cleaned) return false;

  if (cleaned.includes(':')) {
    const hextets = parseIpv6Hextets(cleaned);
    return hextets ? isPublicIpv6Hextets(hextets) : false;
  }

  const strictV4 = cleaned.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (strictV4) {
    const octets: [number, number, number, number] = [
      Number(strictV4[1]),
      Number(strictV4[2]),
      Number(strictV4[3]),
      Number(strictV4[4])
    ];
    return isPublicIpv4Octets(octets);
  }

  const altV4 = parseIpv4Alternative(cleaned);
  return altV4 ? isPublicIpv4Octets(altV4) : false;
}

export function validatePublicHttpUrl(inputUrl: string): UrlSafetyResult {
  if (typeof inputUrl !== 'string') {
    return { safe: false, reason: 'URL invalid sau lipsă.' };
  }

  const trimmed = inputUrl.trim();
  if (!trimmed) {
    return { safe: false, reason: 'URL-ul nu poate fi gol.' };
  }
  if (trimmed.length > 4096) {
    return { safe: false, reason: 'URL-ul depășește lungimea maximă permisă.' };
  }
  if (/[\x00-\x1f\x7f\s]/.test(trimmed)) {
    return { safe: false, reason: 'URL-ul conține caractere de control sau spații nepermise.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { safe: false, reason: 'URL malformat sau invalid.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      safe: false,
      reason: `Protocol nepermis: ${parsed.protocol}. Sunt permise exclusiv http și https.`
    };
  }

  if (parsed.username || parsed.password) {
    return {
      safe: false,
      reason: 'Credențialele încorporate în URL nu sunt permise din motive de securitate.'
    };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const unbracketed = rawHostname.replace(/^\[|\]$/g, '');
  const normalizedHostname = unbracketed.replace(/\.+$/, '');

  if (!normalizedHostname) {
    return { safe: false, reason: 'Hostname-ul lipsește din URL.' };
  }

  // Respinge zone ID sau codări procentuale suspecte în hostname
  if (normalizedHostname.includes('%')) {
    return { safe: false, reason: `Hostname invalid sau conține identificator de zonă: ${normalizedHostname}` };
  }

  if (
    RESERVED_HOSTNAMES.has(normalizedHostname) ||
    RESERVED_HOST_SUFFIXES.some(suffix => normalizedHostname.endsWith(suffix))
  ) {
    return { safe: false, reason: `Acces interzis la adrese locale sau interne: ${normalizedHostname}` };
  }

  // Verificare IPv6 literal (bracketed sau normalizat)
  if (normalizedHostname.includes(':')) {
    const hextets = parseIpv6Hextets(normalizedHostname);
    if (!hextets || !isPublicIpv6Hextets(hextets)) {
      return {
        safe: false,
        reason: `Acces interzis la adrese IPv6 locale, private sau rezervate: ${normalizedHostname}`
      };
    }
    return { safe: true, hostname: normalizedHostname, normalizedUrl: parsed.href };
  }

  // Verificare IPv4 standard sau notații alternative (integer, hex, octal, shorthand)
  const v4Octets = parseIpv4Alternative(normalizedHostname);
  if (v4Octets) {
    if (!isPublicIpv4Octets(v4Octets)) {
      return {
        safe: false,
        reason: `Acces interzis la o adresă IPv4 locală, privată sau rezervată: ${v4Octets.join('.')}`
      };
    }
    return { safe: true, hostname: normalizedHostname, normalizedUrl: parsed.href };
  }

  // Hostname-urile DNS publice trebuie să aibă cel puțin un TLD valid (ex: domeniu.ro) și fără etichete goale
  if (!normalizedHostname.includes('.') || normalizedHostname.includes('..')) {
    return {
      safe: false,
      reason: `Hostname-ul "${normalizedHostname}" nu este un domeniu public complet calificat.`
    };
  }

  return {
    safe: true,
    hostname: normalizedHostname,
    normalizedUrl: parsed.href
  };
}

function getConfiguredSupabaseOrigin(): string | null {
  try {
    const envUrl =
      (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) ||
      'https://bwanbgbimktluajvwzsj.supabase.co';
    return new URL(envUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Normalizează și securizează URL-ul de imagine pentru afișare în client:
 * - Respinge javascript:, data:, file:, localhost, IP-uri private/rezervate.
 * - Păstrează rutele relative locale (/...) și obiectele publice Supabase Storage ale aplicației.
 * - Direcționează URL-urile externe HTTP/HTTPS prin proxy-ul securizat /api/images/proxy.
 */
export function getSafeProductImageSrc(rawImageUrl?: string | null): string | null {
  if (typeof rawImageUrl !== 'string') return null;
  const trimmed = rawImageUrl.trim();
  if (!trimmed) return null;

  // Permite rute relative interne sigure (ex: /assets/..., /api/images/proxy?url=...)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
    return trimmed;
  }

  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  const safety = validatePublicHttpUrl(candidate);
  if (!safety.safe || !safety.normalizedUrl) {
    return null;
  }

  try {
    const parsed = new URL(safety.normalizedUrl);
    if (parsed.pathname.toLowerCase().endsWith('.svg')) {
      return null;
    }

    const supabaseOrigin = getConfiguredSupabaseOrigin();
    if (
      supabaseOrigin &&
      parsed.origin === supabaseOrigin &&
      parsed.pathname.startsWith('/storage/v1/object/public/')
    ) {
      return parsed.href;
    }

    return `/api/images/proxy?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return null;
  }
}
