import React, { useState, useMemo, useEffect } from 'react';
import {
  Database,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Search,
  ExternalLink,
  ChevronDown,
  Layers,
  ArrowRight,
  Filter,
  Check,
  X,
  FileCode,
  Info,
  Lock,
  Key,
  LogOut,
  Send,
  Play,
  Pause,
  Calendar,
  Zap,
  BarChart3,
  Sliders,
  Tag,
  Sparkles,
  ShoppingBag
} from 'lucide-react';
import { DataSource, SourceSyncRun, ProductMatchCandidate, ProductOffer, Store } from '../types';
import {
  RetailerRegistryEntry,
  BatchProcessingResult,
  PromotionRecord,
  ReceiptDiscoveryItem,
  IndexingMonitorStats
} from '../indexing/types';
import { INITIAL_RETAILER_ENTRIES } from '../indexing/RetailerRegistry';
import { StorageService } from '../services/StorageService';
import { FileImportAdapter, LidlPriceFileAdapter } from '../sources/FileImportAdapter';
import { MonitorulPreturilorAdapter } from '../sources/MonitorulPreturilorAdapter';
import { ReceiptSourceAdapter } from '../sources/ReceiptSourceAdapter';
import { AffiliateFeedAdapter } from '../sources/AffiliateFeedAdapter';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { STORES } from '../data/mockData';
import { AdminIndexQualityTab } from './AdminIndexQualityTab.tsx';

interface AdminSourcesViewProps {
  onRefreshAll?: () => void;
}

export const AdminSourcesView: React.FC<AdminSourcesViewProps> = ({ onRefreshAll }) => {
  const [activeTab, setActiveTab] = useState<
    'indexing' | 'sources' | 'import' | 'matching' | 'discovery' | 'promotions' | 'quality' | 'logs' | 'expired'
  >('indexing');


  // Admin authentication state
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('cosul_meu_admin_token') || '';
    } catch {
      return '';
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('cosul_meu_admin_auth') === 'true';
    } catch {
      return false;
    }
  });
  const [authInput, setAuthInput] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState<boolean>(false);

  // Dynamic state from storage
  const [dataSources, setDataSources] = useState<DataSource[]>(() => StorageService.getDataSources());
  const [syncRuns, setSyncRuns] = useState<SourceSyncRun[]>(() => StorageService.getSyncRuns());
  const [matchCandidates, setMatchCandidates] = useState<ProductMatchCandidate[]>(() => StorageService.getMatchCandidates());
  const [offers, setOffers] = useState<ProductOffer[]>(() => StorageService.getProductOffers());

  // Import form state
  const [selectedSourceId, setSelectedSourceId] = useState<string>('src-lidl-file');
  const [selectedStoreId, setSelectedStoreId] = useState<string>('lidl');
  const [importFormat, setImportFormat] = useState<'csv' | 'xml'>('csv');
  const [fileContent, setFileContent] = useState<string>('');
  const [dryRunOnly, setDryRunOnly] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [serverValidationResult, setServerValidationResult] = useState<any>(null);
  const [dbStatus, setDbStatus] = useState<{
    configured: boolean;
    connected: boolean;
    persistenceMode: 'postgresql' | 'demo_memory';
    dbType: string;
    message: string;
  } | null>(null);

  // Indexing engine state for the 8 retailers
  const [retailers, setRetailers] = useState<RetailerRegistryEntry[]>(INITIAL_RETAILER_ENTRIES);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [executingRetailerId, setExecutingRetailerId] = useState<string | null>(null);
  const [indexingExecutionResult, setIndexingExecutionResult] = useState<BatchProcessingResult | null>(null);

  // Discovery & Promotions State
  const [receiptCandidates, setReceiptCandidates] = useState<ReceiptDiscoveryItem[]>(() => StorageService.getReceiptProducts());
  const [promotions, setPromotions] = useState<PromotionRecord[]>(() => StorageService.getPromotions());
  const [monitorStats, setMonitorStats] = useState<IndexingMonitorStats | null>(null);
  const [scheduleHour, setScheduleHour] = useState<number>(4);
  const [scheduleMinute, setScheduleMinute] = useState<number>(0);
  const [isSavingSchedule, setIsSavingSchedule] = useState<boolean>(false);
  const [scheduleSaveMsg, setScheduleSaveMsg] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [discoveryResult, setDiscoveryResult] = useState<any>(null);

  const fetchRetailersAndScheduler = () => {
    fetch('/api/indexing/retailers')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.retailers) {
          setRetailers(data.retailers);
        }
      })
      .catch(() => {});

    fetch('/api/indexing/status')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.status) {
          setSchedulerStatus(data.status);
          if (data.status.targetHour !== undefined) setScheduleHour(data.status.targetHour);
          if (data.status.targetMinute !== undefined) setScheduleMinute(data.status.targetMinute);
        }
      })
      .catch(() => {});

    fetch('/api/indexing/monitor')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.stats) {
          setMonitorStats(data.stats);
        }
      })
      .catch(() => {});

    fetch('/api/indexing/receipt-candidates')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.candidates) {
          setReceiptCandidates(data.candidates);
        }
      })
      .catch(() => {});

    fetch('/api/indexing/promotions')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.promotions) {
          setPromotions(data.promotions);
        }
      })
      .catch(() => {});
  };

  const handleSaveSchedule = async () => {
    setIsSavingSchedule(true);
    setScheduleSaveMsg(null);
    try {
      const res = await fetch('/api/indexing/schedule/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          targetHour: Number(scheduleHour),
          targetMinute: Number(scheduleMinute),
          timezone: 'Europe/Bucharest'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setScheduleSaveMsg(`Programare salvată cu succes: zilnic la ${String(scheduleHour).padStart(2, '0')}:${String(scheduleMinute).padStart(2, '0')} (Europe/Bucharest).`);
        fetchRetailersAndScheduler();
      } else {
        setScheduleSaveMsg(`Eroare: ${data.error || 'Nu s-a putut salva'}`);
      }
    } catch (err: any) {
      setScheduleSaveMsg(`Eroare rețea: ${err.message}`);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleRunReceiptDiscovery = async (dryRun: boolean = false) => {
    setIsDiscovering(true);
    setDiscoveryResult(null);
    try {
      const res = await fetch('/api/indexing/receipt-candidates/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ dryRun, maxItems: 10 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDiscoveryResult(data.result);
        fetchRetailersAndScheduler();
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsDiscovering(false);
    }
  };


  useEffect(() => {
    if (isAuthenticated) {
      fetchRetailersAndScheduler();
      fetch('/api/storage/status')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setDbStatus({
              configured: data.configured,
              connected: data.connected,
              persistenceMode: data.persistenceMode,
              dbType: data.dbType,
              message: data.message
            });
          }
        })
        .catch(() => {});
    }
  }, [isAuthenticated]);

  const handleRunRetailer = async (retailerId: string, dryRun: boolean) => {
    setExecutingRetailerId(retailerId);
    setIndexingExecutionResult(null);

    try {
      const res = await fetch(`/api/indexing/retailers/${retailerId}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ dryRun })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIndexingExecutionResult(data.result);
        fetchRetailersAndScheduler();
        refreshState();
      } else {
        alert(data.error || 'Eroare la execuția jobului de indexare.');
      }
    } catch (err: any) {
      alert(`Eroare de rețea: ${err.message}`);
    } finally {
      setExecutingRetailerId(null);
    }
  };

  const handleTogglePause = async (retailerId: string, currentStatus: string) => {
    const isPaused = currentStatus === 'paused';
    const endpoint = isPaused
      ? `/api/indexing/retailers/${retailerId}/resume`
      : `/api/indexing/retailers/${retailerId}/pause`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ reason: isPaused ? undefined : 'Suspendat manual de administrator.' })
      });

      if (res.ok) {
        fetchRetailersAndScheduler();
      }
    } catch (err: any) {
      alert(`Eroare la modificarea stării: ${err.message}`);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const token = authInput.trim();
    if (!token) {
      setAuthError('Introduceți cheia administrativă.');
      return;
    }
    setIsVerifyingAuth(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/admin/verify-token', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        setAdminToken(token);
        setIsAuthenticated(true);
        try {
          sessionStorage.setItem('cosul_meu_admin_token', token);
          sessionStorage.setItem('cosul_meu_admin_auth', 'true');
        } catch {}
      } else {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || 'Token administrativ invalid sau acces neautorizat (401/403).');
      }
    } catch (err: any) {
      // Fallback in test/demo offline context
      if (token === 'cosul-meu-admin-dev-secret-2026') {
        setAdminToken(token);
        setIsAuthenticated(true);
      } else {
        setAuthError('Eroare la contactarea serverului pentru verificare.');
      }
    } finally {
      setIsVerifyingAuth(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminToken('');
    setAuthInput('');
    try {
      sessionStorage.removeItem('cosul_meu_admin_token');
      sessionStorage.removeItem('cosul_meu_admin_auth');
    } catch {}
  };

  const handleValidateOnServer = async () => {
    if (!fileContent.trim()) return;
    setIsProcessing(true);
    setServerValidationResult(null);

    try {
      const res = await fetch('/api/admin/validate-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          content: fileContent,
          format: importFormat
        })
      });

      const data = await res.json();
      if (res.ok) {
        setServerValidationResult({
          success: true,
          message: `Serverul a acceptat și validat fișierul (${data.contentLength} caractere). Format: ${data.format.toUpperCase()}. Limita de 5MB respectată.`
        });
      } else {
        setServerValidationResult({
          success: false,
          error: data.error || `Eroare server (Cod HTTP ${res.status}).`
        });
      }
    } catch (err: any) {
      setServerValidationResult({
        success: false,
        error: `Eroare rețea: ${err.message}`
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const refreshState = () => {
    setDataSources(StorageService.getDataSources());
    setSyncRuns(StorageService.getSyncRuns());
    setMatchCandidates(StorageService.getMatchCandidates());
    setOffers(StorageService.getProductOffers());
    if (onRefreshAll) onRefreshAll();
  };

  // Expired offers count
  const expiredOffers = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return offers.filter(o => o.verificationStatus === 'expired' || (o.validUntil && o.validUntil < todayStr));
  }, [offers]);

  // Load sample template for Lidl CSV import
  const handleLoadSampleCSV = () => {
    const sample = `denumire,pret,gramaj,unitate,marca,cod_bare,promotie,valabil_pana,card_fidelitate
Lapte proaspat 1.5% 1L,6.49,1,l,Napolact,5941014002341,,,
Oua proaspete M 10 buc,9.99,10,buc,Din Ograda,5941889001221,Super Weekend,2026-11-05,
Paine feliata alba Toast 500g,4.49,0.5,kg,Vel Pitar,5941033001091,,,
Piept de pui dezosat 1kg,26.90,1,kg,Agricola,5941199003310,-10% Lidl Plus,2026-11-05,Lidl Plus
Banane calitatea I (la kg),6.49,1,kg,Import,2000000004011,,,
Ulei floarea-soarelui 1L,6.29,1,l,Untdelemn de la Bunica,5941031002011,,,
Faina alba superioara 000 1kg,3.19,1,kg,Baneasa,5941029001123,,,
Detergent vase Lemon 800ml,11.99,0.8,l,Fairy,5410076451290,,,
Zahar cristal alb 1kg,4.19,1,kg,Diamant,5941045001923,,,
Cafea macinata Kronung 500g,24.90,0.5,kg,Jacobs,8711000504123,,,`;

    setFileContent(sample);
    setImportFormat('csv');
  };

  // Execute import using Server-side API with PostgreSQL / Demo persistence
  const handleRunImport = async () => {
    if (!fileContent.trim()) return;
    setIsProcessing(true);
    setImportResult(null);

    try {
      const res = await fetch(`/api/admin/sources/${selectedSourceId}/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          content: fileContent,
          format: importFormat,
          storeId: selectedStoreId,
          dryRun: dryRunOnly
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setImportResult({
          success: true,
          dryRun: data.dryRun,
          persisted: data.persisted,
          persistenceMode: data.persistenceMode,
          syncRun: {
            recordsProcessed: data.recordsProcessed,
            recordsImported: data.recordsImported,
            duplicatesFound: data.duplicatesFound,
            invalidRecords: data.invalidRecords,
            errors: data.errors || []
          },
          summaryMessage: data.summary,
          candidatesCreated: data.candidatesCreated
        });
        refreshState();
      } else {
        setImportResult({
          success: false,
          summaryMessage: data.error || `Eroare server (${res.status})`
        });
      }
    } catch (err: any) {
      // Fallback in pure offline or testing mode
      try {
        const adapter = selectedSourceId === 'src-lidl-file'
          ? new LidlPriceFileAdapter()
          : new FileImportAdapter(selectedSourceId, 'Import Manual Fișier', selectedStoreId);

        const result = await adapter.importData({
          content: fileContent,
          format: importFormat,
          storeId: selectedStoreId,
          dryRun: dryRunOnly
        });

        setImportResult({
          ...result,
          persisted: false,
          persistenceMode: 'demo_local',
          summaryMessage: `${result.summaryMessage} (Atenție: Salvat doar în memorie locală browser)`
        });
        refreshState();
      } catch (clientErr: any) {
        setImportResult({
          success: false,
          summaryMessage: `Eroare la import: ${clientErr.message || err.message}`
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Sync crowdsourced receipts
  const handleSyncReceipts = async () => {
    setIsProcessing(true);
    const adapter = new ReceiptSourceAdapter();
    const res = await adapter.importData();
    setImportResult(res);
    refreshState();
    setIsProcessing(false);
  };

  // Handle Match Candidate action
  const handleCandidateAction = async (id: string, action: 'auto_approved' | 'rejected') => {
    try {
      if (adminToken) {
        await fetch(`/api/admin/candidates/${id}/review`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({ status: action })
        });
      }
    } catch {}
    StorageService.updateMatchCandidateStatus(id, action);
    refreshState();
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white rounded-3xl border border-slate-200/90 p-8 shadow-xs">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/70">
          <Lock className="w-7 h-7" />
        </div>
        <div className="text-center mb-6">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Autentificare Administrator Necesară 🔒
          </h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Accesul la gestiunea surselor de date, importul fișierelor oficiale și aprobarea asocierilor de catalog necesită autorizare securizată pe server.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Cheie API Administrator (ADMIN_API_KEY)
            </label>
            <div className="relative">
              <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={authInput}
                onChange={e => setAuthInput(e.target.value)}
                placeholder="Introduceți token-ul administrativ..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                autoFocus
              />
            </div>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isVerifyingAuth}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-60"
          >
            {isVerifyingAuth ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Se verifică autorizarea pe server...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Autorizează Accesul Admin</span>
              </>
            )}
          </button>
        </form>

        {import.meta.env.DEV && (
          <div className="mt-6 pt-5 border-t border-slate-100 text-[11px] text-slate-400 text-center">
            <span>Token demonstrativ (activ doar în dev): </span>
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[10px]">
              cosul-meu-admin-dev-secret-2026
            </code>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold mb-2">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            Panou Administrare • Surse de Date & Prețuri
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Gestiune Surse & Importuri ⚙️
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Sistem extensibil pentru importul, validarea și normalizarea prețurilor din surse autorizate.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Sesiune Admin Autorizată</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors flex items-center gap-1 text-xs font-bold cursor-pointer"
            title="Deconectare administrator"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Deconectare</span>
          </button>
          <button
            onClick={refreshState}
            className="p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Reîmprospătează datele"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Database Persistence Status Banner */}
      <div
        className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          dbStatus?.connected
            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
            : 'bg-amber-50/80 border-amber-200 text-amber-950'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              dbStatus?.connected
                ? 'bg-emerald-600 text-white'
                : 'bg-amber-500 text-white'
            }`}
          >
            <Database className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm">
                {dbStatus?.connected
                  ? 'Bază de Date PostgreSQL: Conectată (Persistență Centralizată Activă)'
                  : 'Mod de Stocare: Demonstrativ & Memorie Locală (Nepersistent)'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  dbStatus?.connected
                    ? 'bg-emerald-200 text-emerald-900'
                    : 'bg-amber-200 text-amber-900'
                }`}
              >
                {dbStatus?.persistenceMode === 'postgresql' ? 'Producție / Multi-User' : 'Demo / Ephemeral'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              {dbStatus?.connected
                ? `${dbStatus.message} • Ofertele importate și observațiile istorice sunt persistate centralizat cu garanție append-only.`
                : 'PostgreSQL nu este configurat pe server. Ofertele și observațiile importate sunt salvate temporar în memorie locală. Pentru persistență multi-utilizator, setați DATABASE_URL sau SQL_HOST.'}
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            fetch('/api/storage/status')
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  setDbStatus({
                    configured: data.configured,
                    connected: data.connected,
                    persistenceMode: data.persistenceMode,
                    dbType: data.dbType,
                    message: data.message
                  });
                }
              });
          }}
          className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Verifică Conexiunea</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('indexing')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'indexing'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Motor Indexare ({retailers.length} Retaileri)
          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
            {retailers.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('sources')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'sources'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Surse Configurate ({dataSources.length})
        </button>

        <button
          onClick={() => setActiveTab('import')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'import'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          Import Fișiere (CSV/XML)
        </button>

        <button
          onClick={() => setActiveTab('matching')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'matching'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Candidați Potrivire
          {matchCandidates.filter(c => c.status === 'pending_confirmation').length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {matchCandidates.filter(c => c.status === 'pending_confirmation').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('discovery')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'discovery'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Descoperire Bonuri
          {receiptCandidates.filter(c => c.targetSearchStatus === 'pending').length > 0 && (
            <span className="bg-sky-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {receiptCandidates.filter(c => c.targetSearchStatus === 'pending').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('promotions')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'promotions'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Tag className="w-3.5 h-3.5 text-emerald-500" />
          Promoții Retaileri ({promotions.length})
        </button>

        <button
          onClick={() => setActiveTab('quality')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'quality'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
          Calitatea Indexului
          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
            Monitor
          </span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Jurnal Sincronizări ({syncRuns.length})
        </button>

        <button
          onClick={() => setActiveTab('expired')}
          className={`px-4 py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'expired'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Oferte Expirate ({expiredOffers.length})
        </button>
      </div>


      {/* TAB 0: Motor Indexare (7 Retaileri România) */}
      {activeTab === 'indexing' && (
        <div className="space-y-6">
          {/* Scheduler & Worker Status Card */}
          <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-xs border border-slate-800">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <h2 className="text-base sm:text-lg font-bold tracking-tight">
                    Motor Hibrid de Indexare a Prețurilor • {retailers.length} Retaileri România (Lidl, Kaufland, Carrefour, Penny, Auchan, Profi, Mega Image, Metro)
                  </h2>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold">
                    WORKER ZILNIC
                  </span>
                </div>
                <p className="text-xs text-slate-400 max-w-2xl">
                  Colectează și normalizează zilnic cataloagele de prețuri pentru Lidl, Kaufland, Carrefour, Penny, Auchan, Profi și Mega Image. Sursele fără acces autorizat rămân dezactivate prudent, respectând politicile de acces și limitele de trafic.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-800/80 p-3 rounded-2xl border border-slate-700/80 text-xs">
                <div>
                  <div className="text-[10px] text-slate-400">Programare zilnică</div>
                  <div className="font-bold text-white flex items-center gap-1 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" /> 04:00 AM (RO)
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Lock concurență</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    {schedulerStatus?.activeLock ? 'Lock Activ' : 'Liber / Unic'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Circuit Breaker</div>
                  <div className="font-bold text-sky-400 flex items-center gap-1 mt-0.5">
                    <Zap className="w-3.5 h-3.5 text-sky-400" /> Max 3 eșecuri
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Limită trafic</div>
                  <div className="font-bold text-amber-300 flex items-center gap-1 mt-0.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-300" /> ≤30 cereri/min
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Indexing Monitor Telemetry & Schedule Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Monitor Telemetry Card */}
            <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900">Monitor Telemetrie & Indexare Live</h3>
                    <p className="text-[11px] text-slate-500">Starea agregată a motorului automat de colectare</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  monitorStats?.systemHealth === 'healthy' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {monitorStats?.systemHealth || 'healthy'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-500 block">Retaileri Configurați</span>
                  <span className="text-base font-extrabold text-slate-900 mt-0.5 block">
                    {monitorStats?.activeRetailersCount ?? 1} / {retailers.length}
                  </span>
                  <span className="text-[10px] text-emerald-600 font-semibold">Activ / Configurat</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-500 block">Total Oferte Active</span>
                  <span className="text-base font-extrabold text-slate-900 mt-0.5 block">
                    {monitorStats?.totalOffersCount ?? offers.length}
                  </span>
                  <span className="text-[10px] text-slate-500">În catalog unificat</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-500 block">Promoții Colectate</span>
                  <span className="text-base font-extrabold text-emerald-600 mt-0.5 block">
                    {monitorStats?.totalPromotionsCount ?? promotions.length}
                  </span>
                  <span className="text-[10px] text-slate-500">Reduceri & carduri</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-500 block">Bonuri în Așteptare</span>
                  <span className="text-base font-extrabold text-sky-600 mt-0.5 block">
                    {receiptCandidates.filter(c => c.targetSearchStatus === 'pending').length}
                  </span>
                  <span className="text-[10px] text-sky-700 font-medium">Candidați căutare</span>
                </div>
              </div>
            </div>

            {/* Schedule Configuration Card */}
            <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-extrabold text-sm text-slate-900">Programare Zilnică Colectare</h3>
                </div>
                <p className="text-[11px] text-slate-500 mb-3">
                  Configurare oră de rulare zilnică în fusul orar Europe/Bucharest.
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Oră Rulare (0-23)</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={scheduleHour}
                      onChange={e => setScheduleHour(Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Minut (0-59)</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={scheduleMinute}
                      onChange={e => setScheduleMinute(Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                </div>

                {scheduleSaveMsg && (
                  <p className="text-[11px] text-emerald-700 mt-2 font-semibold">{scheduleSaveMsg}</p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveSchedule}
                  disabled={isSavingSchedule}
                  className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  {isSavingSchedule ? 'Se salvează...' : 'Actualizează Ora'}
                </button>
              </div>
            </div>
          </div>

          {/* Execution Result Feedback (Modal/Banner) */}
          {indexingExecutionResult && (

            <div className={`p-5 rounded-3xl border shadow-xs animate-in fade-in space-y-3 ${
              indexingExecutionResult.status === 'complete'
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                : indexingExecutionResult.status === 'partial'
                ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                : 'bg-rose-50/90 border-rose-200 text-rose-950'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/5 pb-3">
                <div className="flex items-center gap-2">
                  {indexingExecutionResult.status === 'complete' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : indexingExecutionResult.status === 'partial' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-600" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm">
                      {indexingExecutionResult.summary}
                    </h3>
                    <div className="text-[11px] text-slate-600">
                      Retailer: <strong>{indexingExecutionResult.retailerId.toUpperCase()}</strong> • Durată: {indexingExecutionResult.durationMs}ms • Batch: <code className="font-mono text-[10px]">{indexingExecutionResult.batchId}</code>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    indexingExecutionResult.persisted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}>
                    {indexingExecutionResult.persisted ? 'PostgreSQL Centralizat' : 'Demo Local / Dry-Run'}
                  </span>
                  <button
                    onClick={() => setIndexingExecutionResult(null)}
                    className="p-1 rounded-lg hover:bg-black/5 text-slate-500 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs pt-1">
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Total procesate</span>
                  <strong className="text-sm text-slate-900">{indexingExecutionResult.recordsTotal}</strong>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Valide</span>
                  <strong className="text-sm text-emerald-700">{indexingExecutionResult.recordsValid}</strong>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Auto-potrivite</span>
                  <strong className="text-sm text-blue-700">{indexingExecutionResult.autoMatchedCount}</strong>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Candidați ambigui</span>
                  <strong className="text-sm text-amber-700">{indexingExecutionResult.candidatesCreatedCount}</strong>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Schimbări preț</span>
                  <strong className="text-sm text-purple-700">{indexingExecutionResult.priceChangesCount}</strong>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-black/5">
                  <span className="text-[10px] text-slate-500 block">Erori / Respinse</span>
                  <strong className="text-sm text-rose-700">{indexingExecutionResult.recordsInvalid}</strong>
                </div>
              </div>

              {indexingExecutionResult.errors.length > 0 && (
                <div className="p-3 bg-white/70 rounded-xl border border-rose-200/60 text-xs text-rose-900 max-h-32 overflow-y-auto">
                  <span className="font-bold block mb-1">Erori semnalate pe rânduri individuale:</span>
                  {indexingExecutionResult.errors.map((err, i) => (
                    <div key={i} className="text-[11px]">• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 7 Retailers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {retailers.map(r => {
              const isExecuting = executingRetailerId === r.retailerId;
              const isPaused = r.status === 'paused';
              const isDegraded = r.status === 'degraded';
              const isPending = r.status === 'pending_authorization';
              const isDisabled = r.status === 'disabled';
              const isConfigured = r.status === 'configured';
              const isActive = r.status === 'active';

              return (
                <div
                  key={r.retailerId}
                  className={`bg-white rounded-3xl border p-5 shadow-xs flex flex-col justify-between transition-all ${
                    isActive
                      ? 'border-emerald-300 ring-1 ring-emerald-100'
                      : isDegraded
                      ? 'border-rose-300 ring-1 ring-rose-100'
                      : isPending
                      ? 'border-amber-200 bg-amber-50/20'
                      : isDisabled
                      ? 'border-slate-200 opacity-80 bg-slate-50/50'
                      : 'border-slate-200/90'
                  }`}
                >
                  <div>
                    {/* Header: Retailer + Status Badge */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-base text-slate-900 tracking-tight">
                            {r.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">{r.chain}</div>
                      </div>

                      {/* Status Badges */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : isConfigured
                            ? 'bg-blue-100 text-blue-800'
                            : isPending
                            ? 'bg-amber-100 text-amber-800'
                            : isPaused
                            ? 'bg-orange-100 text-orange-800'
                            : isDegraded
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isActive
                          ? 'Activ'
                          : isConfigured
                          ? 'Configurat'
                          : isPending
                          ? 'Necesită Acord'
                          : isPaused
                          ? 'Suspendat'
                          : isDegraded
                          ? 'Degradat'
                          : 'Dezactivat'}
                      </span>
                    </div>

                    {/* Access Method */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-3">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold">
                        {r.accessMethod === 'official_feed'
                          ? 'Feed Oficial (CSV/XML)'
                          : r.accessMethod === 'authorized_api'
                          ? 'API Autorizat'
                          : r.accessMethod === 'public_catalog_feed'
                          ? 'Catalog Deschis'
                          : 'Import Manual'}
                      </span>
                      <span className="text-[11px] text-slate-400">• Max {r.rateLimitRpm} rpm</span>
                    </div>

                    {/* Suspension / Authorization Reason Note */}
                    {r.suspensionReason && (
                      <div className={`p-2.5 rounded-xl text-[11px] mb-3 leading-relaxed ${
                        isDegraded
                          ? 'bg-rose-50 text-rose-800 border border-rose-200/60'
                          : isPending
                          ? 'bg-amber-50 text-amber-800 border border-amber-200/60'
                          : isDisabled
                          ? 'bg-slate-100 text-slate-600 border border-slate-200/60'
                          : 'bg-slate-50 text-slate-600 border border-slate-200/60'
                      }`}>
                        <div className="font-bold flex items-center gap-1 mb-0.5">
                          {isDegraded ? (
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                          ) : (
                            <Info className="w-3 h-3 text-slate-500" />
                          )}
                          <span>Stare conexiune:</span>
                        </div>
                        {r.suspensionReason}
                      </div>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-3 gap-2 py-2.5 border-t border-b border-slate-100 text-xs mb-3 text-center">
                      <div>
                        <div className="text-[10px] text-slate-400">Oferte active</div>
                        <div className="font-extrabold text-slate-800 text-sm mt-0.5">{r.offersCount}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Auto-match</div>
                        <div className="font-extrabold text-emerald-700 text-sm mt-0.5">{r.autoMatchRate}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Ambiguități</div>
                        <div className="font-extrabold text-amber-600 text-sm mt-0.5">{r.pendingCandidatesCount}</div>
                      </div>
                    </div>

                    {/* Last Run Info */}
                    <div className="text-[10px] text-slate-400 space-y-0.5 mb-4">
                      <div>Ultima rulare: <span className="text-slate-600">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleTimeString('ro-RO') : 'Niciuna'}</span></div>
                      <div>Ultimul succes: <span className="text-slate-600">{r.lastSuccessAt ? new Date(r.lastSuccessAt).toLocaleDateString('ro-RO') : 'Niciunul'}</span></div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={isExecuting}
                        onClick={() => handleRunRetailer(r.retailerId, true)}
                        className="py-1.5 px-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                        <span>Dry-Run</span>
                      </button>

                      <button
                        disabled={isExecuting || isDisabled || isPending}
                        onClick={() => handleRunRetailer(r.retailerId, false)}
                        className="py-1.5 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                        title={isDisabled || isPending ? 'Sursa nu este autorizată pentru rulare automată.' : 'Rulează colectarea pe server'}
                      >
                        {isExecuting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>{isExecuting ? 'Se rulează...' : 'Rulează'}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <button
                        onClick={() => handleTogglePause(r.retailerId, r.status)}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                      >
                        {isPaused ? (
                          <>
                            <Play className="w-3 h-3 text-emerald-600" /> Reia colectarea
                          </>
                        ) : (
                          <>
                            <Pause className="w-3 h-3 text-amber-600" /> Suspendă
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          setSelectedStoreId(r.retailerId);
                          setActiveTab('import');
                          if (r.retailerId === 'lidl') handleLoadSampleCSV();
                        }}
                        className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                      >
                        <Upload className="w-3 h-3" /> Încarcă fișier
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 1: Sources Overview */}
      {activeTab === 'sources' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dataSources.map(source => {
              const isPending = source.status === 'pending_authorization';
              const isActive = source.status === 'active';
              const isManual = source.status === 'configured_manual';

              return (
                <div
                  key={source.id}
                  className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                          {source.type.replace('_', ' ')}
                        </span>
                        <h3 className="font-extrabold text-base text-slate-900 leading-tight">
                          {source.name}
                        </h3>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 shrink-0 ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : isPending
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {isActive && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {isPending && <AlertTriangle className="w-3.5 h-3.5" />}
                        {isManual && <FileText className="w-3.5 h-3.5" />}
                        <span>
                          {isActive
                            ? 'Activ'
                            : isPending
                            ? 'În așteptare autorizare'
                            : 'Configurat manual'}
                        </span>
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 my-3 leading-relaxed">
                      {source.description}
                    </p>

                    {/* Metadata stats */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl text-xs text-slate-700">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Oferte importate:</span>
                        <span className="font-black text-slate-900">{source.importedOffersCount}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Erori semnalate:</span>
                        <span className="font-black text-slate-900">{source.errorCount}</span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-slate-200/60">
                        <span className="text-slate-400 text-[11px] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Ultima sincronizare:{' '}
                          {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString('ro-RO') : 'Niciodată'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions / Specific Guides */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    {source.id === 'src-monitorul-preturilor' && (
                      <button
                        onClick={() => {
                          const guide = MonitorulPreturilorAdapter.getAuthorizationGuide();
                          alert(`Ghid Solicitare Acces Oficial Monitorul Prețurilor:\n\n${guide.steps.join('\n')}\n\nContact: ${guide.contactEmail}`);
                        }}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1"
                      >
                        <Info className="w-3.5 h-3.5" /> Ghid solicitare acces
                      </button>
                    )}

                    {source.id === 'src-lidl-file' && (
                      <button
                        onClick={() => {
                          setActiveTab('import');
                          handleLoadSampleCSV();
                        }}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                      >
                        <Upload className="w-3.5 h-3.5" /> Deschide importator
                      </button>
                    )}

                    {source.id === 'src-verified-receipts' && (
                      <button
                        disabled={isProcessing}
                        onClick={handleSyncReceipts}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Sincronizează bonurile
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: File Importer (CSV / XML) */}
      {activeTab === 'import' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Importator Securizat de Fișiere (CSV / XML)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Încarcă un fișier oficial de prețuri. Aplicația validează strict prețurile pozitive, unitățile de măsură și detectează duplicatele.
            </p>
          </div>

          {/* Configuration Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-sm">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Retailer / Magazin țintă</label>
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-semibold text-slate-800"
              >
                {STORES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Format fișier</label>
              <select
                value={importFormat}
                onChange={e => setImportFormat(e.target.value as 'csv' | 'xml')}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-semibold text-slate-800"
              >
                <option value="csv">CSV (virgulă sau punct și virgulă)</option>
                <option value="xml">XML (structură &lt;item&gt; sau &lt;product&gt;)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Mod simulare (Dry-Run)</label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={dryRunOnly}
                  onChange={e => setDryRunOnly(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Doar validare (fără salvare definitivă)</span>
              </label>
            </div>
          </div>

          {/* Quick Template Button */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Introdu conținutul fișierului mai jos:</span>
            <button
              onClick={handleLoadSampleCSV}
              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
            >
              <FileCode className="w-3.5 h-3.5" /> Încarcă șablon CSV oficial Lidl
            </button>
          </div>

          {/* Textarea for file content */}
          <textarea
            rows={10}
            value={fileContent}
            onChange={e => setFileContent(e.target.value)}
            placeholder="Lipește conținutul CSV sau XML aici..."
            className="w-full font-mono text-xs p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          ></textarea>

          {/* Action Trigger */}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              disabled={isProcessing || !fileContent.trim()}
              onClick={handleValidateOnServer}
              type="button"
              className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Trimite payload-ul către endpoint-ul protejat de pe server pentru verificare autorizată și limită de 5MB"
            >
              <Send className="w-3.5 h-3.5 text-slate-500" />
              <span>Validează pe server (Endpoint protejat)</span>
            </button>

            <button
              disabled={isProcessing || !fileContent.trim()}
              onClick={handleRunImport}
              type="button"
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{isProcessing ? 'Se procesează...' : dryRunOnly ? 'Validează fișierul (Dry-Run)' : 'Validează și Importă Ofertele'}</span>
            </button>
          </div>

          {/* Server validation feedback */}
          {serverValidationResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2 animate-in fade-in ${
                serverValidationResult.success
                  ? 'bg-blue-50 border-blue-200 text-blue-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {serverValidationResult.success ? (
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{serverValidationResult.message || serverValidationResult.error}</span>
            </div>
          )}

          {/* Import Result Feedback */}
          {importResult && (
            <div
              className={`p-4 rounded-2xl border text-xs animate-in fade-in ${
                importResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  {importResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                  )}
                  <span>{importResult.summaryMessage}</span>
                </div>
                {importResult.persistenceMode && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold self-start sm:self-auto ${
                      importResult.persisted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    {importResult.persisted
                      ? 'Stocare: PostgreSQL Bază Centralizată'
                      : 'Stocare: Demo / Memorie Locală'}
                  </span>
                )}
              </div>

              {importResult.syncRun && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200/60 font-medium">
                  <div>Linii procesate: <strong className="text-slate-900">{importResult.syncRun.recordsProcessed}</strong></div>
                  <div>Oferte importate: <strong className="text-slate-900">{importResult.syncRun.recordsImported}</strong></div>
                  <div>Duplicate găsite: <strong className="text-slate-900">{importResult.syncRun.duplicatesFound}</strong></div>
                  <div>Linii invalide: <strong className="text-slate-900">{importResult.syncRun.invalidRecords}</strong></div>
                </div>
              )}

              {importResult.syncRun?.errors?.length > 0 && (
                <div className="mt-3 pt-2 border-t border-rose-200 text-rose-900 space-y-1 max-h-36 overflow-y-auto">
                  <span className="font-bold">Erori semnalate:</span>
                  {importResult.syncRun.errors.map((err: string, i: number) => (
                    <div key={i}>• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Product Matching Candidates */}
      {activeTab === 'matching' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Candidați de Potrivire Produse (Product Matching)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Produsele importate cu grad de similitudine mediu nu sunt asociate automat pentru a preveni erorile. Confirmă sau respinge asocierile.
            </p>
          </div>

          {matchCandidates.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Niciun candidat de potrivire înregistrat.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {matchCandidates.map(candidate => {
                const isPending = candidate.status === 'pending_confirmation';
                const isApproved = candidate.status === 'auto_approved';

                return (
                  <div
                    key={candidate.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{candidate.sourceRawName}</span>
                        {candidate.sourceBrand && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                            {candidate.sourceBrand}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                        <span>Asociat cu: <strong className="text-slate-800">{candidate.matchedProductName}</strong></span>
                        <span>• Similitudine: <strong className="text-emerald-700">{Math.round(candidate.confidenceScore * 100)}%</strong></span>
                        <span>• Metodă: {candidate.matchMethod}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isPending ? (
                        <>
                          <button
                            onClick={() => handleCandidateAction(candidate.id, 'auto_approved')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 flex items-center gap-1 shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5" /> Aprobă
                          </button>
                          <button
                            onClick={() => handleCandidateAction(candidate.id, 'rejected')}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold flex items-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" /> Respinge
                          </button>
                        </>
                      ) : (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isApproved ? 'Aprobat' : 'Respins'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Sync Runs Log */}
      {activeTab === 'logs' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Jurnal Audit Sincronizări</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Istoricul complet al fiecărui import de date, raport de erori și timpi de execuție.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {syncRuns.map(run => (
              <div key={run.id} className="py-3 text-xs text-slate-700">
                <div className="flex items-center justify-between font-bold">
                  <span className="text-sm text-slate-900">{run.sourceName}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                      run.status === 'success'
                        ? 'bg-emerald-100 text-emerald-800'
                        : run.status === 'partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
                <p className="text-slate-600 mt-1">{run.summary}</p>
                <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                  <span>Dată: {new Date(run.completedAt).toLocaleString('ro-RO')}</span>
                  <span>• Importate: {run.recordsImported}</span>
                  <span>• Erori: {run.invalidRecords}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: Receipt Products Discovery */}
      {activeTab === 'discovery' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold text-slate-900">
                  Descoperire Țintită de Produse din Bonuri Fiscale
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
                Produsele identificate pe bonurile scanate devin automat candidați pentru motorul de căutare web pe paginile magazinelor. Astfel, catalogul colectează doar articolele relevante consumatorilor, fără descărcarea inutilă a întregului catalog.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRunReceiptDiscovery(true)}
                disabled={isDiscovering || receiptCandidates.length === 0}
                className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                Dry-Run
              </button>
              <button
                onClick={() => handleRunReceiptDiscovery(false)}
                disabled={isDiscovering || receiptCandidates.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {isDiscovering ? 'Se caută...' : 'Lansează Căutarea pe Retaileri'}
              </button>
            </div>
          </div>

          {discoveryResult && (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs">
              <div className="font-bold flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Căutare țintită finalizată cu succes!
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-emerald-800 mt-2">
                <div>Procesate: <strong>{discoveryResult.processedCount}</strong></div>
                <div>Asociate: <strong>{discoveryResult.matchedCount}</strong></div>
                <div>Oferte create: <strong>{discoveryResult.offersCreatedCount}</strong></div>
                <div>Promoții descoperite: <strong>{discoveryResult.promotionsCreatedCount}</strong></div>
              </div>
            </div>
          )}

          {receiptCandidates.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs">
              Nu există candidați descoperiți din bonuri. Scanează un bon fiscal în secțiunea utilizatorului pentru a popula automat lista de candidați.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
              <div className="bg-slate-50 px-4 py-2.5 font-bold text-slate-700 border-b border-slate-200 grid grid-cols-12 gap-2">
                <span className="col-span-5 sm:col-span-4">Denumire de pe Bon</span>
                <span className="col-span-3 sm:col-span-2">Categorie</span>
                <span className="col-span-2 text-right">Preț Bon</span>
                <span className="col-span-2 text-center">Status Căutare</span>
                <span className="hidden sm:inline sm:col-span-2 text-right">Dată Înregistrare</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {receiptCandidates.map(c => (
                  <div key={c.id} className="px-4 py-2.5 grid grid-cols-12 gap-2 items-center hover:bg-slate-50/50">
                    <span className="col-span-5 sm:col-span-4 font-semibold text-slate-900 truncate" title={c.rawName}>
                      {c.rawName}
                    </span>
                    <span className="col-span-3 sm:col-span-2 text-slate-500 truncate">
                      {c.category || 'Nespecificat'}
                    </span>
                    <span className="col-span-2 text-right font-mono font-bold text-slate-800">
                      {c.extractedPrice ? PriceComparisonService.formatRon(c.extractedPrice) : 'N/A'}
                    </span>
                    <span className="col-span-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        c.targetSearchStatus === 'matched'
                          ? 'bg-emerald-100 text-emerald-800'
                          : c.targetSearchStatus === 'searched'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {c.targetSearchStatus === 'matched' ? 'Asociat' : c.targetSearchStatus === 'searched' ? 'Căutat' : 'În așteptare'}
                      </span>
                    </span>
                    <span className="hidden sm:inline sm:col-span-2 text-right text-[11px] text-slate-400">
                      {new Date(c.createdAt).toLocaleDateString('ro-RO')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Promotions */}
      {activeTab === 'promotions' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Promoții & Reduceri Colectate de la Retaileri
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Indexul centralizat al reducerilor active, prețurilor promoționale și ofertelor exclusive cu card de fidelitate.
            </p>
          </div>

          {promotions.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs">
              Nu există promoții înregistrate curent în index. Rulează colectorii retailerilor sau importă un catalog pentru a indexa reducerile active.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {promotions.map(p => {
                const discountPct = p.normalPrice && p.normalPrice > p.promoPrice
                  ? Math.round(((p.normalPrice - p.promoPrice) / p.normalPrice) * 100)
                  : undefined;

                return (
                  <div key={p.id} className="p-4 rounded-2xl border border-slate-200 hover:border-emerald-300 transition-colors bg-white shadow-2xs space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold text-[10px] uppercase">
                        {p.retailerId}
                      </span>
                      {discountPct && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-extrabold text-[10px]">
                          -{discountPct}%
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-xs text-slate-900 line-clamp-2" title={p.title}>
                      {p.title}
                    </h4>

                    <div className="flex items-baseline gap-2 pt-1">
                      <span className="text-base font-extrabold text-emerald-600">
                        {PriceComparisonService.formatRon(p.promoPrice)}
                      </span>
                      {p.normalPrice && p.normalPrice > p.promoPrice && (
                        <span className="text-xs text-slate-400 line-through">
                          {PriceComparisonService.formatRon(p.normalPrice)}
                        </span>
                      )}
                    </div>

                    {p.loyaltyCardName && (
                      <div className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-semibold inline-block">
                        Card: {p.loyaltyCardName}
                      </div>
                    )}

                    {p.endsAt && (
                      <div className="text-[10px] text-slate-400">
                        Valabil până la: {p.endsAt}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: Calitatea Indexului (Price Quality Monitor & Price Freshness Score) */}
      {activeTab === 'quality' && (
        <AdminIndexQualityTab adminToken={adminToken} onRefreshAll={refreshState} />
      )}

      {/* TAB 5: Expired Offers */}
      {activeTab === 'expired' && (

        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Oferte Expirate</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aceste oferte au depășit data de valabilitate și sunt automat excluse din calculul curent al coșului.
            </p>
          </div>

          {expiredOffers.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Nu există oferte expirate în catalog.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {expiredOffers.map(off => (
                <div key={off.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800">{off.productId} ({off.storeId})</span>
                    <span className="text-slate-400 ml-2">Preț: {PriceComparisonService.formatRon(off.price)}</span>
                  </div>
                  <span className="text-rose-600 font-bold">
                    Expirat la: {off.validUntil || 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
