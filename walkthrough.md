# Security Summary

**Reviewed Files**: 22
**Issues Resolved**: 14 (code-level) + 2 (database migration SQL prepared for manual operator approval)

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Hardcoded Cron Secret | `server.ts` | 6261 | `handleCronPublish` accepted a static fallback secret (`cosul-meu-admin-secret-2026`) even in production and used non-constant-time `===` comparison. | Critical | Fixed | Removed the hardcoded fallback secret completely, enforced `CRON_SECRET` / `ADMIN_API_KEY` env check in production, and switched to SHA-256 `timingSafeTokenEqual`. |
| Client Privilege Escalation | `src/auth/AuthProvider.tsx`, `src/App.tsx`, `src/components/ProfileView.tsx` | 150, 297, 81 | Client signup assigned `user_metadata.is_admin` based on a hardcoded email and UI components derived admin access from mutable `user_metadata` or email comparison. | Critical | Fixed | Removed client-side `is_admin` assignment and hardcoded email privilege checks; admin status now derives strictly from DB `profiles.role === 'admin'`. |
| DB Trigger Admin Escalation | `src/db/migrations/011_gdpr_and_cookie_consent.sql`, `src/db/migrations/user-profiles-migration.js` | 357, 96 | `handle_new_user_profile()` granted `admin` role whenever `raw_user_meta_data.is_admin = true` or a hardcoded email matched. | Critical | Needs Follow-Up | Authored an explicit idempotent SQL remediation migration (`handle_new_user_profile()` forced `'user'`, `SET search_path = public`) for manual operator application in Supabase. |
| Missing Admin Auth on Quality & Indexing Routes | `server.ts` | 5122, 5195, 5210, 5221, 5346, 5425, 5488, 8302 | `POST /api/indexing/collect-now`, `GET /api/indexing/receipt-candidates`, and 6 `GET /api/quality/*` routes were exposed without `requireAdminAuth`. | High | Fixed | Attached `requireAdminAuth` to all 8 operational/administrative routes and added `indexingCollectNowSchema` Zod validation. |
| Missing PostgreSQL RLS on Auth/Session/Catalog Tables | `src/db/migrations/003_auth_users_sessions.sql`, `src/db/schema.sql` | 1–26, 7–487 | `app_users`, `app_sessions`, `receipt_products`, and catalog/operational tables lacked `ENABLE ROW LEVEL SECURITY`. | High | Needs Follow-Up | Authored full RLS enablement + least-privilege policies + rollback SQL in the FAZA 7 report without auto-executing migrations. |
| SQL Parameter Binding Bug | `server.ts` | 5251 | `GET /api/quality/anomalies` constructed `$1..$3` placeholders in `whereClause` without passing `values` to `pool.query(...)`. | High | Fixed | Passed `, values` as the second argument to `pool.query` and bounded query string filters. |
| Unvalidated Advisory Lock IDs | `src/services/IndexerScheduler.ts` | 37–83 | `acquireAdvisoryLock`, `releaseAdvisoryLock`, and `runWithAdvisoryLock` interpolated numeric lock IDs into SQL without integer bounds validation. | High | Fixed | Added `sanitizeLockId()` enforcing safe 32-bit positive integers `[0..2147483647]` and parameterized `runWithAdvisoryLock` with `$1::bigint`. |
| Shared List IDOR Bypass in Basket & Alerts | `server.ts` | 2968, 3495 | `POST /api/basket/optimize` with inline items and `POST /api/alerts` with `sourceListId` did not verify list ownership/membership when a foreign `listId` was supplied. | High | Fixed | Added `resolveSharedListRoleAndMeta` ownership/membership enforcement on both endpoints. |
| Rate-Limit IP Spoofing & Tracker Reset | `server.ts` | 157, 263–322 | `trust proxy = 1` unconditionally trusted client `X-Forwarded-For`, and the rate-limit tracker called `hits.clear()` at 5,000 keys, wiping active blocks. | Medium | Fixed | Bound `trust proxy` strictly to `VERCEL` / `TRUST_PROXY=true` and replaced `hits.clear()` with expired-window pruning plus bounded eviction. |
| Global 25MB JSON Body Limit | `server.ts` | 160–175 | All routes shared a global `25mb` JSON parser, exposing normal endpoints to memory/CPU DoS. | Medium | Fixed | Scoped default JSON limit to `1mb`; kept `25mb` only on receipt scan/save and `6mb` only on admin file import endpoints. |
| Missing Auth Session Revocation on Logout | `server.ts`, `src/auth.ts` | 2411, 21 | No server-side `/api/auth/logout` endpoint existed to revoke `app_sessions` and clear cookies; `/api/auth/login` also skipped scrypt for missing emails. | Medium | Fixed | Added `POST /api/auth/logout` deleting `app_sessions` row + clearing cookie (`Max-Age=0`), added Zod password/login schemas, and normalized login timing with dummy `scrypt`. |
| Unvalidated Admin/Public Bodies & HTML Alert Injection | `server.ts`, `src/server/validation.ts` | 4727, 5899, 6136, 7259, 7485, 7856 | `report-error`, scheduler routes, staging reviews, bulk delete, and source status lacked Zod schemas; `sendScheduleAlert` interpolated unescaped strings into email HTML. | Medium | Fixed | Enforced Zod validation schemas from `src/server/validation.ts` across all endpoints and escaped email HTML template parameters via `escapeHtml()`. |
| Permissive CSP & Missing Browser Hardening Headers | `server.ts`, `vercel.json` | 211–225, 1–35 | Prod CSP permitted `'unsafe-inline'` scripts and Vercel static config lacked security headers. | Medium | Fixed | Restricted production CSP `script-src` to `'self'`, enforced strict `frame-ancestors`, disabled `X-Powered-By`, and added security headers in `vercel.json`. |
| Raw Error Message Leakage | `server.ts` | 5065, 6150, 6599, 7091, 7662 | Multiple `catch` handlers returned raw `err.message` / database errors directly in HTTP 4xx/5xx JSON responses. | Low | Fixed | Sanitized external error responses to generic Romanian messages while logging details server-side only. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| SSRF & DNS Rebinding | `src/indexing/catalog/CatalogDownloader.ts`, `src/utils/urlSecurity.ts` | Validates protocols, blocks private/loopback/link-local IPv4/IPv6 and alternate integer/hex/octal notations, pins resolved public IPs on socket connect. |
| Receipt Upload Magic Bytes | `src/server/validation.ts` | Inspects leading magic bytes (`JPEG`, `PNG`, `WEBP`, `PDF`) and rejects mismatched or active-content (`SVG`/`HTML`) payloads with HTTP `415`. |
| CSV Formula Injection | `src/services/PriceQualityMonitoringService.ts` | Prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with `'` before CSV serialization. |
| User Record Isolation (API) | `server.ts` | Uses per-request user-scoped Supabase clients (`auth.userClient`) with `eq('user_id', auth.user.id)` and UUID strict format validation across receipts, alerts, GDPR, and budget routes. |

## PoC Verification

### Hardcoded Cron Secret & Timing Bypass on Catalog Publish
#### Summary
| Field | Value |
|---|---|
| Issue Type | Hardcoded Authentication Credential |
| Impact | Critical |
| Affected File | `server.ts:6257-6298` |
| Test Scenario | `POST /api/cron/catalog-publish` with `Authorization: Bearer cosul-meu-admin-secret-2026` |

#### How It Was Fixed
Removed the hardcoded `'cosul-meu-admin-secret-2026'` literal from `handleCronPublish`, enforced presence of `CRON_SECRET` or `ADMIN_API_KEY` in production, and compared incoming tokens with `timingSafeTokenEqual`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/cron/catalog-publish` enters `handleCronPublish` with the old static secret | Request enters auth guard |
| 2 | `allowedSecrets` collects only env `CRON_SECRET` / `ADMIN_API_KEY` (plus dev-only `ADMIN_API_KEY` outside prod); `timingSafeTokenEqual` compares SHA-256 digests | Token does not match any allowed secret |
| 3 | Handler returns HTTP `401 Unauthorized` without running any scheduled job | **Handled Safely** |

#### Conclusion
**Fix Verified** - The legacy hardcoded cron secret is completely removed and always rejected.

### Unauthenticated Access to Price Quality & Indexing Control Routes
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Admin Authorization Middleware |
| Impact | High |
| Affected File | `server.ts:5122, 5195, 8302` |
| Test Scenario | Unauthenticated `POST /api/indexing/collect-now` and `GET /api/quality/overview` |

#### How It Was Fixed
Attached `requireAdminAuth` middleware to `POST /api/indexing/collect-now`, `GET /api/indexing/receipt-candidates`, and all `GET /api/quality/*` endpoints.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Unauthenticated client sends `POST /api/indexing/collect-now` or `GET /api/quality/overview` | Request enters middleware chain |
| 2 | `requireAdminAuth` runs before route handler, checks `Bearer` header against env `ADMIN_API_KEY` | Missing/invalid token intercepted |
| 3 | Responds with HTTP `401` (missing token) or `403` (forged token) without triggering collection or exposing operational data | **Handled Safely** |

#### Conclusion
**Fix Verified** - Unauthenticated or unauthorized callers cannot trigger collectors or read quality metrics.

### Rate-Limit Bypass via Spoofed `X-Forwarded-For` Header
#### Summary
| Field | Value |
|---|---|
| Issue Type | Rate-Limit IP Spoofing |
| Impact | Medium |
| Affected File | `server.ts:157, 263-338` |
| Test Scenario | 20 rapid `POST /api/auth/login` requests rotating `X-Forwarded-For: 10.0.0.1..20` with `x-enforce-rate-limit: true` |

#### How It Was Fixed
Bound Express `trust proxy` strictly to `Boolean(process.env.VERCEL || process.env.TRUST_PROXY === 'true')` so `req.ip` cannot be spoofed when not behind a verified proxy, and replaced `hits.clear()` with expired-entry pruning.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Requests arrive with forged `X-Forwarded-For: 10.0.0.N` headers | Enters `authStrictLimiter` |
| 2 | `getClientIp(req)` reads socket-bound `req.ip` (`127.0.0.1`), ignoring untrusted `X-Forwarded-For` | All requests share the same rate-limit bucket |
| 3 | On request #16 within 60s, `createRateLimiter` returns HTTP `429` with `Retry-After` header | **Handled Safely** |

#### Conclusion
**Fix Verified** - Rotating forged `X-Forwarded-For` headers no longer resets brute-force limits.

### Non-Integer Advisory Lock Injection & Unbound Quality SQL Filter Parameters
#### Summary
| Field | Value |
|---|---|
| Issue Type | SQL Injection Guard & Query Parameter Binding Defect |
| Impact | High |
| Affected File | `src/services/IndexerScheduler.ts:37-83`, `server.ts:5251` |
| Test Scenario | `IndexerScheduler.acquireAdvisoryLock(pg, '1; DROP TABLE users')` and `GET /api/quality/anomalies?status=pending_review&retailerId=lidl` |

#### How It Was Fixed
Added `sanitizeLockId()` validating strict safe integers `[0..2147483647]` before advisory lock queries and passed `values` to `pool.query(..., values)` in `/api/quality/anomalies`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Malicious `lockId` enters `IndexerScheduler.acquireAdvisoryLock` | Enters `sanitizeLockId(lockId)` |
| 2 | `!Number.isSafeInteger(safeId)` triggers explicit exception before `pg.query` executes | Execution aborted safely |
| 3 | Valid filter query on `/api/quality/anomalies` binds `[status, retailerId, severity]` to `$1..$3` via `pool.query(sql, values)` | **Handled Safely** |

#### Conclusion
**Fix Verified** - Neither non-integer advisory locks nor unparameterized anomaly filters can reach PostgreSQL.
