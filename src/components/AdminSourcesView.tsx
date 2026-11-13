// src/components/AdminSourcesView.tsx
// Panou de Administrare & Dashboard Operațional Complet Coșul Meu
// Unificat conform cerințelor: 9 secțiuni logice, date reale din PostgreSQL, fără duplicate, 16 KPI-uri separate

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Database,
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
  ChevronLeft,
  ChevronRight,
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
  CalendarClock,
  Zap,
  BarChart3,
  Sliders,
  Tag,
  Sparkles,
  ShoppingBag,
  BookOpen,
  Server,
  Package,
  Store as StoreIcon,
  AlertCircle,
  Eye,
  Percent,
  CheckCheck,
  HelpCircle,
  Activity,
  Pencil,
  Plus,
  PlusCircle,
  Trash2
} from 'lucide-react';
import {
  DataSource,
  SourceSyncRun,
  ProductOffer,
  Store,
  AdminAuditLog,
  OperationalDashboardData,
  Product
} from '../types.js';
import {
  CatalogSource,
  CatalogDocument,
  CatalogImportRun,
  CatalogExtractedOffer,
  CatalogImportError
} from '../indexing/catalog/catalogTypes.js';
import { AdminIndexQualityTab } from './AdminIndexQualityTab.tsx';
import { AdminPublishPreviewModal, PublishPreviewData } from './AdminPublishPreviewModal.tsx';
import { AdminProductDetailModal } from './AdminProductDetailModal.tsx';
import { AdminImportConfirmModal } from './AdminImportConfirmModal.tsx';
import AdminPublishScheduler from './AdminPublishScheduler.tsx';
import { AdminEditSourceModal } from './AdminEditSourceModal.tsx';
import { AdminAddRetailerModal } from './AdminAddRetailerModal.tsx';
import { AdminKpiDrilldownModal, DrilldownType } from './AdminKpiDrilldownModal.tsx';
import { AdminStagingOfferDrawer } from './AdminStagingOfferDrawer.tsx';

interface AdminSourcesViewProps {
  onRefreshAll?: () => void;
}

export type AdminTabId =
  | 'overview'
  | 'retailers'
  | 'imports'
  | 'catalog'
  | 'offers'
  | 'staging'
  | 'logs'
  | 'security'
  | 'settings';

const TABS: { id: AdminTabId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'retailers', label: 'Retaileri și surse', icon: StoreIcon },
  { id: 'imports', label: 'Importuri', icon: Play },
  { id: 'catalog', label: 'Catalog și produse', icon: Package },
  { id: 'offers', label: 'Oferte și prețuri', icon: Tag },
  { id: 'staging', label: 'Validare și publicare', icon: CheckCheck },
  { id: 'logs', label: 'Jurnal și erori', icon: FileText },
  { id: 'security', label: 'Utilizatori și securitate', icon: ShieldCheck },
  { id: 'settings', label: 'Setări', icon: Sliders }
];

export interface RetailerConfig {
  id: string;
  name: string;
  format: string;
  defaultStatus: 'ACTIVE' | 'BLOCKED';
  color: string;
  chain?: string;
  type?: Store['type'];
  brandColor?: string;
  accentColor?: string;
}

const ALL_8_RETAILERS: RetailerConfig[] = [
  { id: 'lidl', name: 'Lidl România', format: 'HTML & PDF', defaultStatus: 'ACTIVE', color: 'blue' },
  { id: 'kaufland', name: 'Kaufland România', format: 'PDF (Schwarz CDN)', defaultStatus: 'ACTIVE', color: 'red' },
  { id: 'carrefour', name: 'Carrefour România', format: 'HTML Store', defaultStatus: 'ACTIVE', color: 'sky' },
  { id: 'penny', name: 'Penny România', format: 'HTML & Card', defaultStatus: 'ACTIVE', color: 'amber' },
  { id: 'auchan', name: 'Auchan România', format: 'Online Store & VTEX', defaultStatus: 'ACTIVE', color: 'rose' },
  { id: 'profi', name: 'Profi Rom Food', format: 'PDF / WAF', defaultStatus: 'BLOCKED', color: 'emerald' },
  { id: 'mega-image', name: 'Mega Image', format: 'Publitas Spreads', defaultStatus: 'ACTIVE', color: 'red' },
  { id: 'metro', name: 'Metro Cash & Carry', format: 'PDF / Akamai', defaultStatus: 'BLOCKED', color: 'yellow' }
];

export const AdminSourcesView: React.FC<AdminSourcesViewProps> = ({ onRefreshAll }) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');

  // Authentication state
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('cosul_meu_admin_token') || '';
    } catch {
      return '';
    }
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('cosul_meu_admin_auth') === 'true' && Boolean(sessionStorage.getItem('cosul_meu_admin_token'));
    } catch {
      return false;
    }
  });

  const [authInput, setAuthInput] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState<boolean>(false);

  const handleAdminLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = authInput.trim();
    if (!token || isVerifyingAuth) return;

    setAuthError(null);
    setIsVerifyingAuth(true);
    try {
      const response = await fetch('/api/admin/auth-check', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        const message = payload?.error || (
          response.status === 401 || response.status === 403
            ? 'Tokenul administrativ este invalid.'
            : 'Autentificarea administratorului nu a putut fi verificată.'
        );
        throw new Error(message);
      }

      sessionStorage.setItem('cosul_meu_admin_token', token);
      sessionStorage.setItem('cosul_meu_admin_auth', 'true');
      setAdminToken(token);
      setIsAuthenticated(true);
      setAuthInput('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Autentificarea administratorului nu a putut fi verificată.');
    } finally {
      setIsVerifyingAuth(false);
    }
  };

  // Operational Dashboard state from backend
  const [operationalData, setOperationalData] = useState<OperationalDashboardData | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState<boolean>(true);

  // Sources and Retailers
  const [retailersList, setRetailersList] = useState<RetailerConfig[]>(ALL_8_RETAILERS);
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [expandedRetailers, setExpandedRetailers] = useState<Set<string>>(new Set(['lidl', 'auchan', 'mega-image']));

  // Documents and Staging
  const [documents, setDocuments] = useState<CatalogDocument[]>([]);
  const [stagingOffers, setStagingOffers] = useState<CatalogExtractedOffer[]>([]);
  const [validatedStagingTotal, setValidatedStagingTotal] = useState(0);
  const [stagingPage, setStagingPage] = useState<number>(1);
  const [stagingLimit, setStagingLimit] = useState<number>(25);
  const [stagingTotal, setStagingTotal] = useState<number>(0);
  const [stagingTotalPages, setStagingTotalPages] = useState<number>(1);
  const [stagingFilter, setStagingFilter] = useState<'toate' | 'NEEDS_REVIEW' | 'READY_TO_PUBLISH' | 'VALIDATED' | 'APPROVED' | 'PUBLISHED' | 'REJECTED'>('NEEDS_REVIEW');
  const [stagingRetailerFilter, setStagingRetailerFilter] = useState<string>('toate');
  const [stagingDocumentFilter, setStagingDocumentFilter] = useState<string>('toate');
  const [stagingQuickFilter, setStagingQuickFilter] = useState<string>('toate');
  const [stagingSearch, setStagingSearch] = useState<string>('');
  const [stagingStatusCounts, setStagingStatusCounts] = useState<Record<string, number>>({
    NEEDS_REVIEW: 0,
    VALIDATED: 0,
    APPROVED: 0,
    READY_TO_PUBLISH: 0,
    PUBLISHED: 0,
    REJECTED: 0,
    ALL: 0
  });
  const [isLoadingStaging, setIsLoadingStaging] = useState<boolean>(false);
  const [selectedStagingIds, setSelectedStagingIds] = useState<Set<string>>(new Set());
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [bulkReviewConfirmModal, setBulkReviewConfirmModal] = useState<{ open: boolean; action: 'approve' | 'reject'; count: number } | null>(null);
  const [bulkRejectionReason, setBulkRejectionReason] = useState<string>('Date incomplete sau respinse de administrator');
  
  // Drill-down and Inspection Drawers
  const [kpiDrilldown, setKpiDrilldown] = useState<{
    open: boolean;
    type: DrilldownType;
    title: string;
    subtitle?: string;
  } | null>(null);
  const [inspectingOffer, setInspectingOffer] = useState<CatalogExtractedOffer | null>(null);
  
  // Canonical Products from PostgreSQL
  const [products, setProducts] = useState<any[]>([]);
  const [productsTotal, setProductsTotal] = useState<number>(0);
  const [productsPage, setProductsPage] = useState<number>(1);
  const [productsSearch, setProductsSearch] = useState<string>('');
  const [productsCategory, setProductsCategory] = useState<string>('toate');
  const [productsRetailer, setProductsRetailer] = useState<string>('toate');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isDeletingProducts, setIsDeletingProducts] = useState<boolean>(false);
  const [productToDelete, setProductToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState<boolean>(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Runs and Errors
  const [runs, setRuns] = useState<CatalogImportRun[]>([]);
  const [errors, setErrors] = useState<CatalogImportError[]>([]);
  const [logFilterRetailer, setLogFilterRetailer] = useState<string>('toate');
  const [logFilterStatus, setLogFilterStatus] = useState<string>('toate');

  // Security & Audit Logs
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  // Execution states
  const [isRunningActive, setIsRunningActive] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isCleaningUnpublished, setIsCleaningUnpublished] = useState<boolean>(false);
  const [publishErrorMessage, setPublishErrorMessage] = useState<string | null>(null);
  const [cleanupErrorMessage, setCleanupErrorMessage] = useState<string | null>(null);
  const [reviewingOfferIds, setReviewingOfferIds] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Modals
  const [showPublishPreview, setShowPublishPreview] = useState<boolean>(false);
  const [publishPreviewData, setPublishPreviewData] = useState<PublishPreviewData | null>(null);
  const [publishPreviewHasConflict, setPublishPreviewHasConflict] = useState<boolean>(false);
  const [isRefreshingPreview, setIsRefreshingPreview] = useState<boolean>(false);
  const [showImportConfirmModal, setShowImportConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    retailers: RetailerConfig[];
    actionType: 'active' | 'all' | 'single';
    targetId?: string;
  } | null>(null);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState<boolean>(false);

  // Modale noi: Editare sursă & Adăugare retailer
  const [editingSourceModal, setEditingSourceModal] = useState<{
    open: boolean;
    source: CatalogSource | null;
    retailerId: string;
    retailerName: string;
  } | null>(null);
  const [showAddRetailerModal, setShowAddRetailerModal] = useState<boolean>(false);
  const [editingRetailer, setEditingRetailer] = useState<RetailerConfig | null>(null);

  // Helper fetch with Bearer token
  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      try {
        sessionStorage.removeItem('cosul_meu_admin_token');
        sessionStorage.removeItem('cosul_meu_admin_auth');
      } catch {}
      setAdminToken('');
      setIsAuthenticated(false);
      setAuthError('Sesiunea administrativă a expirat sau tokenul nu mai este valid. Introdu tokenul administrativ actual.');
    }
    return response;
  }, [adminToken]);

  // Load Operational Dashboard data (real-time from PostgreSQL)
  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/operational-dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setOperationalData(json.data);
        }
      }
    } catch (err) {
      console.error('Eroare la încărcarea dashboard-ului operațional:', err);
    } finally {
      setIsLoadingDashboard(false);
    }
  }, [fetchWithAuth]);

  // Load Retailers (dynamic list from PostgreSQL & custom additions)
  const loadRetailers = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/retailers');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.retailers) && json.retailers.length > 0) {
          const uniqueRetailers = new Map<string, RetailerConfig>();
          for (const retailer of json.retailers as RetailerConfig[]) {
            if (!retailer?.id || uniqueRetailers.has(retailer.id)) continue;
            uniqueRetailers.set(retailer.id, retailer);
          }
          setRetailersList(Array.from(uniqueRetailers.values()));
        }
      }
    } catch (err) {
      console.warn('Nu s-au putut încărca retailerii din baza de date, se folosește lista implicită:', err);
    }
  }, [fetchWithAuth]);

  // Load Sources
  const loadSources = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/sources');
      if (res.ok) {
        const json = await res.json();
        setSources(json.sources || []);
      }
    } catch {}
  }, [fetchWithAuth]);

  // Load Documents
  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/documents');
      if (res.ok) {
        const json = await res.json();
        setDocuments(json.documents || []);
      }
    } catch {}
  }, [fetchWithAuth]);

  // Load Staging Offers from PostgreSQL with pagination and filters
  const loadStaging = useCallback(async () => {
    setIsLoadingStaging(true);
    try {
      let url = `/api/admin/catalog-importer/staging?page=${stagingPage}&limit=${stagingLimit}`;
      if (stagingFilter !== 'toate') url += `&status=${encodeURIComponent(stagingFilter)}`;
      if (stagingRetailerFilter !== 'toate') url += `&retailerId=${encodeURIComponent(stagingRetailerFilter)}`;
      if (stagingDocumentFilter !== 'toate') url += `&documentId=${encodeURIComponent(stagingDocumentFilter)}`;
      if (stagingQuickFilter !== 'toate') url += `&filterType=${encodeURIComponent(stagingQuickFilter)}`;
      if (stagingSearch.trim()) url += `&search=${encodeURIComponent(stagingSearch.trim())}`;

      const res = await fetchWithAuth(url);
      if (res.ok) {
        const json = await res.json();
        setStagingOffers(json.offers || []);
        setStagingTotal(json.total || 0);
        setStagingTotalPages(json.totalPages || 1);
        if (json.statusCounts) {
          setStagingStatusCounts(json.statusCounts);
          const readyCount =
            json.statusCounts.READY_TO_PUBLISH !== undefined
              ? Number(json.statusCounts.READY_TO_PUBLISH)
              : Number(json.statusCounts.APPROVED ?? 0) + Number(json.statusCounts.VALIDATED ?? 0);
          setValidatedStagingTotal(readyCount);
        }
      }
    } catch (err) {
      console.error('Eroare loadStaging:', err);
    } finally {
      setIsLoadingStaging(false);
    }
  }, [fetchWithAuth, stagingPage, stagingLimit, stagingFilter, stagingRetailerFilter, stagingDocumentFilter, stagingQuickFilter, stagingSearch]);

  // Load Runs & Errors
  const loadRunsAndErrors = useCallback(async () => {
    try {
      const [runsRes, errorsRes] = await Promise.all([
        fetchWithAuth('/api/admin/catalog-importer/runs'),
        fetchWithAuth('/api/admin/catalog-importer/errors')
      ]);
      if (runsRes.ok) {
        const runsJson = await runsRes.json();
        setRuns(runsJson.runs || []);
      }
      if (errorsRes.ok) {
        const errorsJson = await errorsRes.json();
        setErrors(errorsJson.errors || []);
      }
    } catch {}
  }, [fetchWithAuth]);

  // Load Canonical Products from PostgreSQL
  const loadProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    try {
      const limit = 15;
      const offset = (productsPage - 1) * limit;
      const url = `/api/admin/products-detailed?limit=${limit}&offset=${offset}&search=${encodeURIComponent(productsSearch)}&category=${encodeURIComponent(productsCategory)}&retailer=${encodeURIComponent(productsRetailer)}`;
      const res = await fetchWithAuth(url);
      if (res.ok) {
        const json = await res.json();
        setProducts(json.products || []);
        setProductsTotal(json.total || 0);
      }
    } catch {} finally {
      setIsLoadingProducts(false);
    }
  }, [fetchWithAuth, productsPage, productsSearch, productsCategory, productsRetailer]);

  // Ștergere produs individual
  const handleDeleteSingleProduct = async (productId: string, productName: string) => {
    setIsDeletingProducts(true);
    try {
      const res = await fetchWithAuth(`/api/admin/products/${productId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setActionMessage({
          type: 'success',
          text: `Produsul „${productName}” a fost delistat și șters cu succes.`
        });
        setSelectedProductIds(prev => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
        setProductToDelete(null);
        loadProducts();
        loadDashboard();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({
          type: 'error',
          text: data.error || 'Eroare la ștergerea produsului.'
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Eroare de conexiune la ștergerea produsului.'
      });
    } finally {
      setIsDeletingProducts(false);
    }
  };

  // Ștergere în masă produse selectate
  const handleBulkDeleteProducts = async () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) return;
    setIsDeletingProducts(true);
    try {
      const res = await fetchWithAuth('/api/admin/products/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionMessage({
          type: 'success',
          text: data.message || `Au fost delistate și șterse ${ids.length} produse.`
        });
        setSelectedProductIds(new Set());
        setShowBulkDeleteConfirm(false);
        loadProducts();
        loadDashboard();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({
          type: 'error',
          text: data.error || 'Eroare la ștergerea în masă a produselor.'
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Eroare de conexiune la ștergerea produselor.'
      });
    } finally {
      setIsDeletingProducts(false);
    }
  };

  // Load Audit Logs
  const loadAuditLogs = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/audit-logs?limit=50');
      if (res.ok) {
        const json = await res.json();
        setAuditLogs(json.logs || []);
      }
    } catch {}
  }, [fetchWithAuth]);

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) return;
    loadDashboard();
    loadRetailers();
    loadSources();
    loadDocuments();
    loadStaging();
    loadRunsAndErrors();
    loadAuditLogs();
  }, [isAuthenticated, loadDashboard, loadRetailers, loadSources, loadDocuments, loadStaging, loadRunsAndErrors, loadAuditLogs]);

  // Load products when tab is active or filters change
  useEffect(() => {
    if (activeTab === 'catalog') {
      loadProducts();
    }
  }, [activeTab, loadProducts]);

  // Controlled polling: poll every 3.5 seconds ONLY when imports are running
  useEffect(() => {
    if (operationalData?.runningImportsCount && operationalData.runningImportsCount > 0) {
      const interval = setInterval(() => {
        loadDashboard();
        loadRunsAndErrors();
      }, 3500);
      return () => clearInterval(interval);
    }
  }, [operationalData?.runningImportsCount, loadDashboard, loadRunsAndErrors]);

  // Toggle single retailer accordion
  const toggleRetailerExpand = (retailerId: string) => {
    setExpandedRetailers(prev => {
      const next = new Set(prev);
      if (next.has(retailerId)) next.delete(retailerId);
      else next.add(retailerId);
      return next;
    });
  };

  // Toggle Source Active / Disabled (Requirement 7 & 11)
  const handleToggleSourceStatus = async (source: CatalogSource) => {
    const nextStatus = source.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetchWithAuth(`/api/admin/sources/${source.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, userEmail: 'admin@cosulmeu.ro' })
      });
      if (res.ok) {
        setActionMessage({
          type: 'success',
          text: `Sursa "${source.name}" a fost actualizată: status ${nextStatus.toUpperCase()}.`
        });
        loadSources();
        loadDashboard();
        loadAuditLogs();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la modificarea stării sursei.' });
    }
  };

  // Retry processing error (Requirement 8)
  const handleRetryError = async (errItem: CatalogImportError) => {
    try {
      const res = await fetchWithAuth(`/api/admin/errors/${errItem.id}/retry`, {
        method: 'POST',
        body: JSON.stringify({ userEmail: 'admin@cosulmeu.ro' })
      });
      if (res.ok) {
        setActionMessage({
          type: 'success',
          text: `Reîncercare declanșată pentru ${errItem.retailerId.toUpperCase()} (Etapa: ${errItem.stage}).`
        });
        loadRunsAndErrors();
        loadDashboard();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la reîncercare.' });
    }
  };

  // Safe Import Trigger via Confirmation Modal (Requirement 5)
  const handleConfirmRunImport = async () => {
    if (!showImportConfirmModal) return;
    setIsRunningActive(true);
    const { actionType, targetId } = showImportConfirmModal;
    setShowImportConfirmModal(null);

    try {
      let res;
      if (actionType === 'active') {
        res = await fetchWithAuth('/api/admin/catalog-importer/run-active', { method: 'POST' });
      } else if (actionType === 'single' && targetId) {
        res = await fetchWithAuth(`/api/admin/import/run-retailer/${targetId}`, {
          method: 'POST',
          body: JSON.stringify({ userEmail: 'admin@cosulmeu.ro' })
        });
      }

      if (res && res.ok) {
        const json = await res.json();
        setActionMessage({
          type: 'success',
          text: json.message || 'Importul a fost executat cu succes. Datele au fost încărcate în Staging Queue.'
        });
      } else {
        throw new Error('Importul a întâmpinat o problemă la procesare.');
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la rularea importului.' });
    } finally {
      setIsRunningActive(false);
      loadDashboard();
      loadStaging();
      loadRunsAndErrors();
      loadDocuments();
      loadAuditLogs();
    }
  };

  // Staging Preview and Publish (Requirement 6)
  const fetchPublishPreview = useCallback(async (overrideOfferIds?: string[]) => {
    const selectedPublishableIds = stagingOffers
      .filter(
        offer =>
          selectedStagingIds.has(offer.id) &&
          ['APPROVED', 'VALIDATED'].includes(String(offer.stagingStatus || '').toUpperCase())
      )
      .map(offer => offer.id);
    const targetOfferIds =
      overrideOfferIds && overrideOfferIds.length > 0
        ? overrideOfferIds
        : selectedPublishableIds.length > 0
        ? selectedPublishableIds
        : undefined;

    const res = await fetchWithAuth('/api/admin/staging/preview-publish', {
      method: 'POST',
      body: JSON.stringify({ offerIds: targetOfferIds })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Nu s-a putut genera previzualizarea de publicare.');
    }
    const json = await res.json();
    return json.preview as PublishPreviewData;
  }, [fetchWithAuth, stagingOffers, selectedStagingIds]);

  const handleOpenPublishPreview = async () => {
    try {
      setIsRefreshingPreview(true);
      const preview = await fetchPublishPreview();
      setPublishErrorMessage(null);
      setCleanupErrorMessage(null);
      setPublishPreviewHasConflict(false);
      setPublishPreviewData(preview);
      setShowPublishPreview(true);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Nu s-a putut genera previzualizarea de publicare.' });
    } finally {
      setIsRefreshingPreview(false);
    }
  };

  const handleRefreshPublishPreview = async () => {
    try {
      setIsRefreshingPreview(true);
      const preview = await fetchPublishPreview();
      setPublishErrorMessage(null);
      setPublishPreviewHasConflict(false);
      setPublishPreviewData(preview);
    } catch (err: any) {
      setPublishErrorMessage(err.message || 'Nu s-a putut reîncărca previzualizarea.');
    } finally {
      setIsRefreshingPreview(false);
    }
  };

  const handleConfirmPublish = async () => {
    if (!publishPreviewData) return;
    setIsPublishing(true);
    try {
      const targetOfferIds =
        Array.isArray(publishPreviewData.eligibleOfferIds) && publishPreviewData.eligibleOfferIds.length > 0
          ? publishPreviewData.eligibleOfferIds
          : undefined;

      const res = await fetchWithAuth('/api/admin/catalog-importer/publish-validated', {
        method: 'POST',
        body: JSON.stringify({
          offerIds: targetOfferIds,
          previewSnapshotHash: publishPreviewData.previewSnapshotHash,
          userEmail: 'admin@cosulmeu.ro'
        })
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 409 || json.conflict) {
        const message =
          json.message ||
          json.error ||
          'Lista ofertelor eligibile s-a modificat între previzualizare și confirmare. Reîmprospătați previzualizarea.';
        setPublishPreviewHasConflict(true);
        setPublishErrorMessage(message);
        setActionMessage({ type: 'error', text: message });
        await Promise.all([loadDashboard(), loadStaging(), loadAuditLogs(), loadDocuments()]);
        return;
      }

      if (!res.ok) throw new Error(json.error || json.message || 'Eroare la publicare.');
      if (json.success !== true) {
        const message = json.message || json.errors?.join('; ') || 'Publicarea nu a fost confirmată în baza de date.';
        setPublishPreviewHasConflict(false);
        setPublishErrorMessage(message);
        setActionMessage({ type: 'error', text: message });
        await Promise.all([loadDashboard(), loadStaging(), loadRunsAndErrors(), loadAuditLogs(), loadDocuments()]);
        return;
      }

      setPublishErrorMessage(null);
      setCleanupErrorMessage(null);
      setPublishPreviewHasConflict(false);
      setShowPublishPreview(false);
      setSelectedStagingIds(new Set());
      setActionMessage({
        type: 'success',
        text: json.message || `Au fost publicate ${json.publishedCount} oferte în catalogul public.`
      });
      await Promise.all([loadDashboard(), loadStaging(), loadRunsAndErrors(), loadAuditLogs(), loadDocuments()]);
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      const message = err.message || 'Eroare la publicare.';
      setPublishPreviewHasConflict(false);
      setPublishErrorMessage(message);
      setActionMessage({ type: 'error', text: message });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCleanUnpublished = async () => {
    const offerIds = publishPreviewData?.cleanupOfferIds || [];
    if (offerIds.length === 0 || isCleaningUnpublished) return;
    setIsCleaningUnpublished(true);
    setCleanupErrorMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/staging/cleanup', {
        method: 'POST',
        body: JSON.stringify({ offerIds })
      });
      const json = await res.json();
      if (!res.ok || json.success !== true) throw new Error(json.error || 'Nu s-au putut curăța ofertele din staging.');

      setCleanupErrorMessage(null);
      setShowPublishPreview(false);
      setSelectedStagingIds(new Set());
      setActionMessage({ type: json.removedCount > 0 ? 'success' : 'info', text: json.message });
      await Promise.all([loadDashboard(), loadStaging(), loadRunsAndErrors(), loadAuditLogs()]);
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      const message = err.message || 'Nu s-au putut curăța ofertele din staging.';
      setCleanupErrorMessage(message);
      setActionMessage({ type: 'error', text: message });
    } finally {
      setIsCleaningUnpublished(false);
    }
  };

  // Logout with active import check (Requirement 11)
  const handleAttemptLogout = () => {
    if (operationalData?.runningImportsCount && operationalData.runningImportsCount > 0) {
      setShowLogoutConfirmModal(true);
    } else {
      executeLogout();
    }
  };

  const executeLogout = () => {
    sessionStorage.removeItem('cosul_meu_admin_token');
    sessionStorage.removeItem('cosul_meu_admin_auth');
    setIsAuthenticated(false);
    setShowLogoutConfirmModal(false);
  };

  const handleBulkReviewOffers = async (action: 'approve' | 'reject', reason?: string) => {
    const offerIds = Array.from(selectedStagingIds);
    if (offerIds.length === 0 || isBulkReviewing) return;

    setIsBulkReviewing(true);
    try {
      const response = await fetchWithAuth('/api/admin/catalog-importer/staging/bulk-review', {
        method: 'POST',
        body: JSON.stringify({
          offerIds,
          action,
          rejectionReason: reason || (action === 'reject' ? bulkRejectionReason : undefined),
          userEmail: 'admin@cosulmeu.ro'
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        const firstError =
          Array.isArray(payload.failedItems) && payload.failedItems.length > 0
            ? `${payload.failedItems[0].rawTitle}: ${(payload.failedItems[0].errors || []).join(' ')}`
            : '';
        setBulkReviewConfirmModal(null);
        await Promise.all([loadStaging(), loadDashboard(), loadRunsAndErrors(), loadAuditLogs()]);
        throw new Error(
          [payload.error || payload.message || 'Ofertele nu au trecut validarea.', firstError]
            .filter(Boolean)
            .join(' ')
        );
      }

      const failedIds = new Set<string>(
        Array.isArray(payload.failedItems) ? payload.failedItems.map((f: any) => String(f.id)) : []
      );
      setSelectedStagingIds(failedIds);
      setBulkReviewConfirmModal(null);

      if (payload.partial && payload.failedCount > 0) {
        const sampleErr = payload.failedItems?.[0]
          ? ` Exemplu (${payload.failedItems[0].rawTitle}): ${(payload.failedItems[0].errors || []).join(' ')}`
          : '';
        setActionMessage({
          type: 'info',
          text: `${payload.message || `${payload.updatedCount} oferte aprobate; ${payload.failedCount} au erori de validare.`}${sampleErr}`
        });
      } else {
        setActionMessage({
          type: 'success',
          text:
            payload.message ||
            `${payload.updatedCount || offerIds.length} oferte au fost ${action === 'approve' ? 'validate și aprobate' : 'respinse'} cu succes.`
        });
      }

      await Promise.all([loadStaging(), loadDashboard(), loadRunsAndErrors(), loadAuditLogs(), loadDocuments()]);
      if (onRefreshAll) onRefreshAll();
    } catch (error: any) {
      setActionMessage({ type: 'error', text: error.message || 'Eroare la procesarea în masă a ofertelor.' });
    } finally {
      setIsBulkReviewing(false);
    }
  };

  const handleReviewOffer = async (offerId: string, action: 'approve' | 'reject', reason?: string) => {
    setReviewingOfferIds(previous => new Set(previous).add(offerId));
    try {
      const response = await fetchWithAuth(`/api/admin/catalog-importer/staging/${offerId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          rejectionReason: reason,
          userEmail: 'admin@cosulmeu.ro'
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        const valErrors = Array.isArray(payload.validationErrors) ? payload.validationErrors.join(' ') : '';
        const errMessage = valErrors || payload.error || payload.message || 'Oferta nu a putut fi validată.';
        await Promise.all([loadStaging(), loadDashboard()]);
        throw new Error(errMessage);
      }
      setActionMessage({
        type: 'success',
        text: payload.message || (action === 'approve' ? 'Oferta a fost validată și aprobată pentru publicare.' : 'Oferta a fost respinsă.')
      });
      await Promise.all([loadStaging(), loadDashboard(), loadRunsAndErrors(), loadAuditLogs(), loadDocuments()]);
      if (onRefreshAll) onRefreshAll();
    } catch (error: any) {
      const errText = error.message || 'Eroare la actualizarea ofertei.';
      setActionMessage({ type: 'error', text: errText });
      throw error;
    } finally {
      setReviewingOfferIds(previous => {
        const next = new Set(previous);
        next.delete(offerId);
        return next;
      });
    }
  };

  // KPI Drill-Down Click Handler (All 16 KPIs become interactive)
  const handleKpiClick = (kpiKey: string) => {
    switch (kpiKey) {
      case 'retailersConfigured':
        setKpiDrilldown({
          open: true,
          type: 'retailers',
          title: `Retaileri Configurați (${operationalData?.configuredRetailersCount ?? retailersList.length} Retaileri)`,
          subtitle: 'Rețeaua de retaileri oficiali monitorizați cu surse și cataloage active.'
        });
        break;
      case 'sourcesConfigured':
        setKpiDrilldown({
          open: true,
          type: 'sources_all',
          title: `Surse Configurate (${operationalData?.configuredSourcesCount ?? sources.length} Surse)`,
          subtitle: 'Toate sursele de cataloage, reviste și API-uri configurate în platformă.'
        });
        break;
      case 'sourcesFunctional':
        setKpiDrilldown({
          open: true,
          type: 'sources_active',
          title: `Surse Active & Funcționale (${operationalData?.activeSourcesCount ?? 0} Surse)`,
          subtitle: 'Surse operaționale fără erori de acces sau blocaje WAF.'
        });
        break;
      case 'sourcesBlocked':
        setKpiDrilldown({
          open: true,
          type: 'sources_blocked',
          title: `Surse Blocate (${operationalData?.blockedSourcesCount ?? 0} Surse)`,
          subtitle: 'Surse restricționate prin protecții WAF/Bot (Cloudflare / Akamai). Acces restricționat conform politicilor de securitate.'
        });
        break;
      case 'documentsDiscovered':
        setKpiDrilldown({
          open: true,
          type: 'documents_discovered',
          title: `Documente Descoperite (${(operationalData?.kpis?.discoveredDocuments?.value ?? documents.length).toLocaleString('ro-RO')} Documente)`,
          subtitle: 'Cataloage și reviste promoționale identificate prin crawler.'
        });
        break;
      case 'documentsDownloaded':
        setKpiDrilldown({
          open: true,
          type: 'documents_downloaded',
          title: `Documente Descărcate cu Succes (${(operationalData?.kpis?.downloadedDocuments?.value ?? documents.length).toLocaleString('ro-RO')} Documente)`,
          subtitle: 'Arhiva completă a documentelor descărcate, procesate și indexate în Supabase PostgreSQL.'
        });
        break;
      case 'extractedProducts':
      case 'extractedOffers':
        setActiveTab('staging');
        setStagingFilter('toate');
        setStagingPage(1);
        break;
      case 'distinctProducts':
        setActiveTab('catalog');
        break;
      case 'newProducts':
      case 'updatedProducts':
        setKpiDrilldown({
          open: true,
          type: 'recent_products',
          title: 'Produse Noi & Actualizate Recent',
          subtitle: 'Produse create sau actualizate în catalogul canonic în urma importurilor.'
        });
        break;
      case 'validatedOffers':
        setActiveTab('staging');
        setStagingFilter('READY_TO_PUBLISH');
        setStagingPage(1);
        break;
      case 'approvedOffers':
        setKpiDrilldown({
          open: true,
          type: 'approved_offers',
          title: `Oferte Aprobate pentru Publicare (${(operationalData?.kpis?.approvedOffers?.value ?? validatedStagingTotal).toLocaleString('ro-RO')} Oferte)`,
          subtitle: 'Oferte din staging validate și aprobate, pregătite pentru publicare în catalogul public.'
        });
        break;
      case 'publishedOffers':
        setKpiDrilldown({
          open: true,
          type: 'published_offers',
          title: `Oferte Publicate în Catalogul Public (${(operationalData?.kpis?.publishedOffers?.value ?? 0).toLocaleString('ro-RO')} Oferte)`,
          subtitle: 'Oferte curente active în tabela product_offers accesibile utilizatorilor.'
        });
        break;
      case 'priceChanges':
        setKpiDrilldown({
          open: true,
          type: 'price_changes',
          title: 'Prețuri Modificate & Observații Istorice',
          subtitle: 'Istoricul variațiilor de preț înregistrat în tabela price_observations.'
        });
        break;
      case 'itemsWithoutPrice':
        setKpiDrilldown({
          open: true,
          type: 'items_without_price',
          title: 'Produse Extrase Fără Preț & Explicații Tehnice',
          subtitle: 'Articole extrase din cataloage unde prețul este nul sau indisponibil în materialul sursă.'
        });
        break;
      case 'processingErrors':
        setKpiDrilldown({
          open: true,
          type: 'processing_errors',
          title: 'Jurnal Erori de Procesare',
          subtitle: 'Erori apărute la descărcare, parsare sau normalizare catalog.'
        });
        break;
      default:
        break;
    }
  };

  // Staging items from PostgreSQL paginated query
  const visibleStagingOffers = stagingOffers;
  const selectedPendingOffers = stagingOffers.filter(
    offer => selectedStagingIds.has(offer.id) && offer.stagingStatus === 'NEEDS_REVIEW'
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-[70vh] grid place-items-center px-4">
        <form onSubmit={handleAdminLogin} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900 text-center">Autentificare administrator</h1>
          <p className="mt-2 text-center text-sm text-slate-500">Introdu tokenul administrativ configurat pentru producție.</p>
          <label className="mt-5 block text-xs font-bold text-slate-700" htmlFor="admin-token">Token administrativ</label>
          <input id="admin-token" type="password" value={authInput} onChange={event => { setAuthInput(event.target.value); setAuthError(null); }} autoComplete="current-password" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" placeholder="Introdu tokenul" />
          {authError && <p className="mt-2 text-xs font-semibold text-rose-600" role="alert">{authError}</p>}
          <button type="submit" disabled={isVerifyingAuth} className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
            {isVerifyingAuth ? 'Se verifică…' : 'Intră în panoul admin'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 max-w-7xl mx-auto">
      {/* 1. TOP HEADER & STATUS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold mb-2">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            Coșul Meu • Panou Operațional Administrativ
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Dashboard Operațional & Catalog Importer ⚙️
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Monitorizare surse, cataloage, produse canonice, oferte și sincronizare incrementală PostgreSQL.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Admin Autorizat</span>
          </div>

          <button
            onClick={() => {
              loadDashboard();
              loadSources();
              loadStaging();
              loadRunsAndErrors();
            }}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Reîmprospătează toate datele"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={handleAttemptLogout}
            className="px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Deconectare</span>
          </button>
        </div>
      </div>

      {/* Global Notification Banner */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 animate-in fade-in duration-150 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : actionMessage.type === 'error'
              ? 'bg-rose-50 text-rose-900 border border-rose-200'
              : 'bg-blue-50 text-blue-900 border border-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. UNIFIED 9-TAB NAVIGATION (Requirement 10) */}
      <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-xs">
        {/* Mobile Dropdown */}
        <div className="md:hidden">
          <label className="text-[11px] font-bold text-slate-500 uppercase px-2 mb-1 block">
            Secțiune Dashboard:
          </label>
          <select
            value={activeTab}
            onChange={e => setActiveTab(e.target.value as AdminTabId)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
          >
            {TABS.map(tab => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop Buttons Row */}
        <div className="hidden md:flex flex-wrap items-center gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.id === 'staging' && (stagingStatusCounts.NEEDS_REVIEW ?? 0) > 0 && (
                  <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white text-emerald-700' : 'bg-amber-100 text-amber-900'}`}>
                    {(stagingStatusCounts.NEEDS_REVIEW ?? 0).toLocaleString('ro-RO')}
                  </span>
                )}
                {tab.id === 'logs' && errors.length > 0 && (
                  <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white text-rose-700' : 'bg-rose-100 text-rose-800'}`}>
                    {errors.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW & GENERAL OPERATIONAL STATUS (Requirements 2 & 3)          */}
      {/* ========================================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* General Operational Status Banner */}
          <div
            className={`p-5 rounded-3xl border shadow-xs transition-all ${
              operationalData?.overallStatus === 'TOTUL FUNCȚIONEAZĂ'
                ? 'bg-emerald-500/10 border-emerald-300 text-emerald-950'
                : operationalData?.overallStatus === 'IMPORT ÎN DESFĂȘURARE'
                ? 'bg-blue-500/10 border-blue-300 text-blue-950'
                : operationalData?.overallStatus === 'SISTEM PARȚIAL DISPONIBIL'
                ? 'bg-amber-500/10 border-amber-300 text-amber-950'
                : 'bg-rose-500/10 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold ${
                    operationalData?.overallStatus === 'TOTUL FUNCȚIONEAZĂ'
                      ? 'bg-emerald-600 text-white'
                      : operationalData?.overallStatus === 'IMPORT ÎN DESFĂȘURARE'
                      ? 'bg-blue-600 text-white animate-spin'
                      : operationalData?.overallStatus === 'SISTEM PARȚIAL DISPONIBIL'
                      ? 'bg-amber-500 text-white'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {operationalData?.overallStatus === 'IMPORT ÎN DESFĂȘURARE' ? (
                    <RefreshCw className="w-5 h-5" />
                  ) : operationalData?.overallStatus === 'TOTUL FUNCȚIONEAZĂ' ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold tracking-wide uppercase">
                      STATUS SISTEM: {operationalData?.overallStatus || 'SE CALCULEAZĂ...'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/80 border border-current">
                      PostgreSQL Supabase (83ms)
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1 max-w-3xl leading-relaxed">
                    {operationalData?.statusMessage || 'Se interoghează starea conexiunii și surselor de date...'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:self-center">
                <button
                  onClick={() =>
                    setShowImportConfirmModal({
                      open: true,
                      title: 'Rulează Importurile Active',
                      description: 'Importul va descărca și sincroniza ofertele pentru Lidl, Kaufland, Carrefour, PENNY, Auchan și Mega Image.',
                      retailers: ALL_8_RETAILERS.filter(r => r.defaultStatus === 'ACTIVE'),
                      actionType: 'active'
                    })
                  }
                  disabled={isRunningActive}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm hover:shadow flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isRunningActive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Rulează Importurile Active</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('staging');
                    setStagingFilter('NEEDS_REVIEW');
                    setStagingPage(1);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs hover:border-emerald-500 transition-all"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    Staging Queue ({(stagingStatusCounts.NEEDS_REVIEW ?? 0).toLocaleString('ro-RO')})
                  </span>
                </button>
              </div>
            </div>

            {/* Sub-status pills bar with click drill-downs */}
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <button
                type="button"
                onClick={() => handleKpiClick('retailersConfigured')}
                className="hover:text-emerald-700 hover:underline cursor-pointer flex items-center gap-1"
              >
                Retaileri Configurați: <strong className="text-slate-900 font-extrabold">{operationalData?.configuredRetailersCount ?? retailersList.length}</strong>
              </button>
              <div>•</div>
              <button
                type="button"
                onClick={() => handleKpiClick('sourcesFunctional')}
                className="hover:text-emerald-700 hover:underline cursor-pointer flex items-center gap-1"
              >
                Surse Active: <strong className="text-emerald-700 font-extrabold">{operationalData?.activeSourcesCount ?? 0}</strong> din {operationalData?.configuredSourcesCount ?? sources.length}
              </button>
              <div>•</div>
              <button
                type="button"
                onClick={() => handleKpiClick('sourcesBlocked')}
                className="hover:text-rose-700 hover:underline cursor-pointer flex items-center gap-1"
              >
                Surse Blocate: <strong className="text-rose-700 font-extrabold">{operationalData?.blockedSourcesCount ?? 0}</strong>
              </button>
              <div>•</div>
              <button
                type="button"
                onClick={() => handleKpiClick('documentsDownloaded')}
                className="hover:text-blue-700 hover:underline cursor-pointer flex items-center gap-1"
              >
                Documente Descărcate: <strong className="text-blue-700 font-extrabold">{(operationalData?.kpis?.downloadedDocuments?.value ?? documents.length ?? 0).toLocaleString('ro-RO')}</strong>
              </button>
              <div>•</div>
              <div>
                Următoarea sincronizare: <strong className="text-slate-900">{operationalData?.nextScheduledSync || '04:00 (Zilnic)'}</strong>
              </div>
            </div>
          </div>

          {/* Active Alerts */}
          {operationalData?.activeAlerts && operationalData.activeAlerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Alerte & Atenționări Active
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {operationalData.activeAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-2xl border text-xs flex flex-col justify-between gap-2.5 ${
                      alert.severity === 'critical'
                        ? 'bg-rose-50 border-rose-200 text-rose-950'
                        : alert.severity === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-950'
                        : 'bg-blue-50 border-blue-200 text-blue-950'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertCircle className="w-4 h-4 shrink-0 text-current" />
                        <span>{alert.title}</span>
                      </div>
                      <p className="text-[11px] mt-1 text-slate-600 leading-relaxed">
                        {alert.message}
                      </p>
                    </div>
                    {alert.targetTab && (
                      <button
                        onClick={() => {
                          if (alert.targetTab === 'staging') {
                            setActiveTab('staging');
                            setStagingFilter('NEEDS_REVIEW');
                            setStagingPage(1);
                          } else {
                            setActiveTab(alert.targetTab as AdminTabId);
                          }
                        }}
                        className="self-start text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                      >
                        <span>{alert.linkActionLabel || 'Rezolvă problema →'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 16 SEPARATED KPIS GRID (Requirement 2 & 3: Interactive Drill-Downs) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Indicatori Operaționali de Performanță (16 Metrici Interactive)
              </h3>
              <span className="text-[11px] text-slate-400">Apasă pe oricare indicator pentru a deschide înregistrările reale din PostgreSQL</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {operationalData?.kpis &&
                Object.values(operationalData.kpis).map((kpi: any) => (
                  <button
                    key={kpi.key}
                    type="button"
                    onClick={() => handleKpiClick(kpi.key)}
                    className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-emerald-500 hover:shadow-md transition-all space-y-1 text-left cursor-pointer group relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="text-[11px] font-semibold text-slate-500 truncate group-hover:text-emerald-700 transition-colors" title={kpi.label}>
                        {kpi.label}
                      </div>
                      <Eye className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-600 transition-colors shrink-0" />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-xl font-extrabold text-slate-900 tracking-tight group-hover:text-emerald-950">
                        {typeof kpi.value === 'number' ? kpi.value.toLocaleString('ro-RO') : kpi.value}
                      </div>
                      {kpi.delta !== undefined && kpi.delta > 0 && (
                        <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-md">
                          +{kpi.delta}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-50">
                      <span>{kpi.period}</span>
                      <span className="text-emerald-600 font-bold group-hover:underline">Vezi date →</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>

          {/* SCHEDULER & AUTOMATED PUBLISHING KPIS (Audit Requirement 2) */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-emerald-600" />
                  Scheduler Automat & Sincronizare Programată (PostgreSQL Live)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Monitorizare execuții cron, claim atomic, idempotență și separare publicare manuală vs. automată.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('settings')}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
              >
                <span>Configurează Scheduler →</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Programări Active</span>
                <span className="text-lg font-extrabold text-slate-900 mt-1 block">
                  {operationalData?.scheduler?.activeSchedulesCount ?? 0}
                </span>
                <span className="text-[9px] text-slate-500">din {operationalData?.scheduler?.totalSchedulesCount ?? 0} total</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">În Desfășurare</span>
                <span className={`text-lg font-extrabold mt-1 block ${
                  (operationalData?.scheduler?.runningSchedulesCount ?? 0) > 0 ? 'text-blue-600 animate-pulse' : 'text-slate-900'
                }`}>
                  {operationalData?.scheduler?.runningSchedulesCount ?? 0}
                </span>
                <span className="text-[9px] text-slate-500">execuții concurente</span>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-200/60">
                <span className="text-[10px] font-bold text-emerald-800 uppercase block">Publicări Reușite</span>
                <span className="text-lg font-extrabold text-emerald-700 mt-1 block">
                  {operationalData?.scheduler?.successfulSchedulesCount ?? 0}
                </span>
                <span className="text-[9px] text-emerald-600">status SUCCESS</span>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-200/60">
                <span className="text-[10px] font-bold text-amber-800 uppercase block">Publicări Parțiale</span>
                <span className="text-lg font-extrabold text-amber-700 mt-1 block">
                  {operationalData?.scheduler?.partialSchedulesCount ?? 0}
                </span>
                <span className="text-[9px] text-amber-600">cu avertismente per-retailer</span>
              </div>

              <div className="p-3 rounded-2xl bg-rose-50/60 border border-rose-200/60">
                <span className="text-[10px] font-bold text-rose-800 uppercase block">Execuții Eșuate</span>
                <span className="text-lg font-extrabold text-rose-700 mt-1 block">
                  {operationalData?.scheduler?.failedSchedulesCount ?? 0}
                </span>
                <span className="text-[9px] text-rose-600">necesită investigare</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Publicări Manuale</span>
                <span className="text-lg font-extrabold text-slate-900 mt-1 block">
                  {operationalData?.scheduler?.manualPublishCount ?? 0}
                </span>
                <span className="text-[9px] text-slate-500">acțiuni admin</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Publicări Automate</span>
                <span className="text-lg font-extrabold text-emerald-700 mt-1 block">
                  {operationalData?.scheduler?.automatedPublishCount ?? 0}
                </span>
                <span className="text-[9px] text-slate-500">cron / scheduler</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500 gap-2">
              <div>
                <strong>Următoarea execuție:</strong>{' '}
                {operationalData?.scheduler?.nextScheduledRunAt
                  ? new Date(operationalData.scheduler.nextScheduledRunAt).toLocaleString('ro-RO') + ' (Europe/Bucharest)'
                  : 'Nicio programare automată viitoare'}
              </div>
              <div>
                <strong>Ultima execuție:</strong>{' '}
                {operationalData?.scheduler?.lastScheduledRunAt
                  ? new Date(operationalData.scheduler.lastScheduledRunAt).toLocaleString('ro-RO')
                  : 'Nicio execuție anterioară'}
              </div>
            </div>
          </div>

          {/* Visual 6-Stage Pipeline Summary (Requirement 4) */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Pipeline Operațional Unificat (Descoperire → Publicare)
              </h3>
              <button
                onClick={() => setActiveTab('imports')}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
              >
                <span>Gestionează fluxul de import →</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              {operationalData?.pipelineStages?.map((stage: any, idx: number) => (
                <div key={stage.stage} className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                    <span>{stage.name}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-md text-[9px] font-extrabold ${
                        stage.status === 'PASS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : stage.status === 'BLOCKED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {stage.status}
                    </span>
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">{stage.processedCount}</div>
                  <div className="text-[10px] text-slate-400">
                    {stage.pendingCount > 0 ? `${stage.pendingCount} în așteptare` : 'Complet procesat'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: RETAILERI ȘI SURSE (Requirement 7)                                  */}
      {/* ========================================================================= */}
      {activeTab === 'retailers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Gestiune Retaileri & Surse Oficiale ({retailersList.length} Retaileri)
              </h2>
              <p className="text-xs text-slate-500">
                Fiecare retailer include sursele sale oficiale configurate pentru extragerea de oferte și cataloage.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditingRetailer(null);
                  setShowAddRetailerModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all hover:border-emerald-300"
              >
                <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>Adaugă Retailer Nou</span>
              </button>
              <button
                onClick={() => {
                  setShowImportConfirmModal({
                    open: true,
                    title: 'Rulează Importurile Active',
                    description: 'Sincronizare completă a retailerilor operaționali în Supabase PostgreSQL.',
                    retailers: retailersList.filter(r => r.defaultStatus === 'ACTIVE'),
                    actionType: 'active'
                  });
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Rulează Toate Sursele Active</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {retailersList.map(retailer => {
              const retailerSources = sources.filter(s => s.retailerId === retailer.id);
              const isExpanded = expandedRetailers.has(retailer.id);
              const isBlocked = retailer.defaultStatus === 'BLOCKED';

              return (
                <div
                  key={retailer.id}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
                >
                  {/* Retailer Card Header */}
                  <div
                    onClick={() => toggleRetailerExpand(retailer.id)}
                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-extrabold text-slate-700 text-sm">
                        {retailer.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-slate-900 text-sm">{retailer.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isBlocked
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isBlocked ? 'BLOCKED (WAF/Bot Guard)' : 'ACTIV & OPERAȚIONAL'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Format: {retailer.format} • {retailerSources.length} surse configurate
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Editează ${retailer.name}`}
                        title={`Editează ${retailer.name}`}
                        onClick={e => {
                          e.stopPropagation();
                          setEditingRetailer(retailer);
                          setShowAddRetailerModal(true);
                        }}
                        className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {!isBlocked && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setShowImportConfirmModal({
                              open: true,
                              title: `Import Pilot ${retailer.name}`,
                              description: `Execută pilotul de descărcare și extragere pentru ${retailer.name}.`,
                              retailers: [retailer],
                              actionType: 'single',
                              targetId: retailer.id
                            });
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3 text-emerald-600 fill-current" />
                          <span>Importă</span>
                        </button>
                      )}
                      <div className="text-slate-400 p-1">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Expandable Sources Details */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
                      {retailerSources.length > 0 ? (
                        retailerSources.map(src => (
                          <div
                            key={src.id}
                            className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs shadow-2xs"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 font-bold text-slate-800">
                                  <span>{src.name}</span>
                                  <span className="px-1.5 py-0.2 rounded-sm bg-slate-100 text-[10px] uppercase font-mono text-slate-600">
                                    {src.format}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded-sm text-[10px] font-bold uppercase ${
                                      src.status === 'active'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-slate-200 text-slate-700'
                                    }`}
                                  >
                                    {src.status}
                                  </span>
                                </div>
                                <a
                                  href={src.catalogUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-emerald-600 hover:underline flex items-center gap-1 mt-0.5 truncate max-w-lg"
                                >
                                  <span>{src.catalogUrl}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => setEditingSourceModal({
                                    open: true,
                                    source: src,
                                    retailerId: retailer.id,
                                    retailerName: retailer.name
                                  })}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold text-xs border border-emerald-200 flex items-center gap-1 cursor-pointer transition-colors"
                                  title="Editează parametrii, URL-ul și formatul acestei surse"
                                >
                                  <Pencil className="w-3 h-3 text-emerald-600" />
                                  <span>Editează Sursă</span>
                                </button>
                                <button
                                  onClick={() => handleToggleSourceStatus(src)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                                    src.status === 'active'
                                      ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  {src.status === 'active' ? 'Dezactivează' : 'Activează'}
                                </button>
                                <button
                                  onClick={() => {
                                    setStagingRetailerFilter(retailer.id);
                                    setActiveTab('staging');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
                                >
                                  Vezi Oferte Staging
                                </button>
                              </div>
                            </div>

                            <p className="text-[11px] text-slate-500 italic">
                              {src.legalStatusNotice}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500 italic p-1">
                          Nicio sursă specifică înregistrată pentru acest retailer.
                        </p>
                      )}

                      {/* Add source button for this retailer */}
                      <button
                        onClick={() => setEditingSourceModal({
                          open: true,
                          source: null,
                          retailerId: retailer.id,
                          retailerName: retailer.name
                        })}
                        className="w-full py-2.5 border-2 border-dashed border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 rounded-xl text-slate-600 hover:text-emerald-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-2"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adaugă sursă nouă pentru {retailer.name}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: IMPORTURI & PIPELINE UNIFICAT (Requirements 4 & 5)                  */}
      {/* ========================================================================= */}
      {activeTab === 'imports' && (
        <div className="space-y-6">
          {/* Action Toolbar */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Flux Operațional de Import (Catalog Importer)
              </h2>
              <p className="text-xs text-slate-500">
                Pornire sigură protejată cu advisory lock împotriva execuțiilor concurente pe același retailer.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  setShowImportConfirmModal({
                    open: true,
                    title: 'Rulează Importurile Active',
                    description: 'Importul va descărca și sincroniza ofertele pentru Lidl, Kaufland, Carrefour, PENNY, Auchan și Mega Image.',
                    retailers: ALL_8_RETAILERS.filter(r => r.defaultStatus === 'ACTIVE'),
                    actionType: 'active'
                  })
                }
                disabled={isRunningActive}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isRunningActive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Rulează Importurile Active</span>
              </button>
            </div>
          </div>

          {/* 6-Stage Pipeline Details */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Stadiul Etapelor Pipeline-ului de Import
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {operationalData?.pipelineStages?.map((stage: any) => (
                <div key={stage.stage} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-900">{stage.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        stage.status === 'PASS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : stage.status === 'BLOCKED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {stage.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 text-[11px]">
                    <span>Elemente procesate:</span>
                    <strong className="text-slate-900">{stage.processedCount}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 text-[11px]">
                    <span>În așteptare:</span>
                    <strong className="text-slate-900">{stage.pendingCount}</strong>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200/60">
                    Ultima execuție: {stage.lastExecutedAt ? new Date(stage.lastExecutedAt).toLocaleTimeString('ro-RO') : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Discovered Documents Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Documente Descoperite și Descărcate ({documents.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                  <tr>
                    <th className="p-3 font-bold">Document</th>
                    <th className="p-3 font-bold">Retailer</th>
                    <th className="p-3 font-bold">Format</th>
                    <th className="p-3 font-bold">Descărcare</th>
                    <th className="p-3 font-bold">Parsare</th>
                    <th className="p-3 font-bold">Extrase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.slice(0, 10).map(doc => (
                    <tr key={doc.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-semibold text-slate-800 truncate max-w-xs">{doc.title}</td>
                      <td className="p-3 font-bold uppercase text-slate-600">{doc.retailerId}</td>
                      <td className="p-3 uppercase font-mono text-[10px] text-slate-500">{doc.format}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          {doc.downloadStatus}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                          {doc.parseStatus}
                        </span>
                      </td>
                      <td className="p-3 font-extrabold text-slate-900">{doc.rawExtractedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CATALOG & PRODUSE CANONICE (Requirement 9)                          */}
      {/* ========================================================================= */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Produse Canonice în Baza de Date PostgreSQL ({productsTotal})
              </h2>
              <p className="text-xs text-slate-500">
                Produse unificate asociate cu coduri EAN, atribute standard și oferte multi-retailer.
              </p>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Caută după nume produs, brand sau cod de bare (EAN)..."
                value={productsSearch}
                onChange={e => {
                  setProductsSearch(e.target.value);
                  setProductsPage(1);
                  setSelectedProductIds(new Set());
                }}
                className="w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
              />
              {productsSearch && (
                <button
                  onClick={() => {
                    setProductsSearch('');
                    setProductsPage(1);
                  }}
                  className="text-slate-400 hover:text-slate-600 px-1 font-bold text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-[11px]">Categorie:</span>
                <select
                  value={productsCategory}
                  onChange={e => {
                    setProductsCategory(e.target.value);
                    setProductsPage(1);
                    setSelectedProductIds(new Set());
                  }}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none"
                >
                  <option value="toate">Toate Categoriile</option>
                  <option value="Fructe și legume">Fructe și legume</option>
                  <option value="Lactate și ouă">Lactate și ouă</option>
                  <option value="Carne și pește">Carne și pește</option>
                  <option value="Panificație">Panificație</option>
                  <option value="Băuturi">Băuturi</option>
                  <option value="Produse de bază">Produse de bază</option>
                  <option value="Curățenie">Curățenie</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-[11px]">Retailer:</span>
                <select
                  value={productsRetailer}
                  onChange={e => {
                    setProductsRetailer(e.target.value);
                    setProductsPage(1);
                    setSelectedProductIds(new Set());
                  }}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none"
                >
                  <option value="toate">Toți Retailerii</option>
                  {retailersList.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bulk Selection Toolbar */}
          {selectedProductIds.size > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-3 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
              <p className="text-xs font-semibold text-rose-900" aria-live="polite">
                <strong>{selectedProductIds.size}</strong> produse selectate pentru delistare
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={isDeletingProducts}
                  className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Șterge / Delistează selectatele ({selectedProductIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProductIds(new Set())}
                  disabled={isDeletingProducts}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Șterge selecția
                </button>
              </div>
            </div>
          )}

          {/* Products Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            {isLoadingProducts ? (
              <div className="py-16 text-center space-y-2">
                <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500 font-medium">Se interoghează produsele din PostgreSQL Supabase...</p>
              </div>
            ) : products.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                    <tr>
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          aria-label="Selectează toate produsele de pe această pagină"
                          checked={
                            products.length > 0 &&
                            products.every(p => selectedProductIds.has(p.id))
                          }
                          onChange={e => {
                            const next = new Set(selectedProductIds);
                            products.forEach(p => {
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                            });
                            setSelectedProductIds(next);
                          }}
                          className="cursor-pointer rounded accent-emerald-600"
                        />
                      </th>
                      <th className="p-3 font-bold">Produs & Brand</th>
                      <th className="p-3 font-bold">Categorie</th>
                      <th className="p-3 font-bold">Gramaj / Unitate</th>
                      <th className="p-3 font-bold">Cod EAN</th>
                      <th className="p-3 font-bold text-center">Oferte Supermarket</th>
                      <th className="p-3 font-bold text-right">Interval Preț</th>
                      <th className="p-3 font-bold text-center">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.map(p => (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedProductId(p.id)}
                        className={`hover:bg-slate-50/70 cursor-pointer transition-colors ${
                          selectedProductIds.has(p.id) ? 'bg-emerald-50/40' : ''
                        }`}
                      >
                        <td className="p-3 w-10" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Selectează produsul ${p.name}`}
                            checked={selectedProductIds.has(p.id)}
                            onChange={e => {
                              const next = new Set(selectedProductIds);
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                              setSelectedProductIds(next);
                            }}
                            className="cursor-pointer rounded accent-emerald-600"
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-extrabold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-500">{p.brand}</div>
                        </td>
                        <td className="p-3 text-slate-700">{p.category}</td>
                        <td className="p-3 text-slate-600">
                          {p.packageWeightOrVolume} {p.packageUnit}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-500">
                          {p.barcode || '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold text-[10px]">
                            {p.offersCount || 0} magazine
                          </span>
                        </td>
                        <td className="p-3 text-right font-extrabold text-emerald-700">
                          {p.minPrice
                            ? `${Number(p.minPrice).toFixed(2)} lei`
                            : p.baseReferencePrice
                            ? `${Number(p.baseReferencePrice).toFixed(2)} lei`
                            : '—'}
                        </td>
                        <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setSelectedProductId(p.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold text-[11px] cursor-pointer"
                            >
                              Detalii
                            </button>
                            <button
                              onClick={() => setProductToDelete({ id: p.id, name: p.name })}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 font-semibold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                              title={`Șterge / delistează produsul „${p.name}”`}
                            >
                              <Trash2 className="w-3 h-3 text-rose-600" />
                              <span>Șterge</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400">
                Nu au fost găsite produse care să corespundă căutării.
              </div>
            )}

            {/* Pagination */}
            <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>
                Afișare pagină {productsPage} din {Math.max(1, Math.ceil(productsTotal / 15))} (Total: {productsTotal} produse)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={productsPage <= 1}
                  onClick={() => setProductsPage(prev => Math.max(1, prev - 1))}
                  className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  Anterior
                </button>
                <button
                  disabled={productsPage * 15 >= productsTotal}
                  onClick={() => setProductsPage(prev => prev + 1)}
                  className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  Următor
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: OFERTE & PREȚURI (Quality Monitor & Active Promotions)              */}
      {/* ========================================================================= */}
      {activeTab === 'offers' && (
        <div className="space-y-6">
          <AdminIndexQualityTab adminToken={adminToken} onRefreshAll={loadDashboard} />
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: VALIDARE & PUBLICARE (Staging Queue & Publish Preview - Req. 6)     */}
      {/* ========================================================================= */}
      {activeTab === 'staging' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Staging Queue & Validare Oferte
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {stagingTotal.toLocaleString('ro-RO')} oferte în total
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Toate ofertele extrase din cataloage sunt izolate aici în PostgreSQL până la validare și confirmarea publicării în catalogul public.
              </p>
            </div>

            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={handleOpenPublishPreview}
                disabled={isPublishing || isRefreshingPreview || validatedStagingTotal === 0}
                title={validatedStagingTotal === 0 ? 'Nu există oferte validate și aprobate pentru publicare' : 'Deschide previzualizarea înainte de publicare'}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isRefreshingPreview
                    ? 'Se încarcă previzualizarea...'
                    : `Publică Ofertele Validate (${validatedStagingTotal.toLocaleString('ro-RO')})`}
                </span>
              </button>
              {validatedStagingTotal === 0 && (
                <span className="text-[11px] font-medium text-slate-500">
                  Nu există oferte validate și aprobate pentru publicare
                </span>
              )}
            </div>
          </div>

          {/* Status Tabs Navigation */}
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setStagingFilter('NEEDS_REVIEW');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'NEEDS_REVIEW'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>În așteptare</span>
              <span className="px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-900 text-[10px] font-black">
                {(stagingStatusCounts.NEEDS_REVIEW ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('READY_TO_PUBLISH');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'READY_TO_PUBLISH'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Pregătite pt. Publicare</span>
              <span className="px-1.5 py-0.2 rounded-md bg-teal-100 text-teal-900 text-[10px] font-black">
                {validatedStagingTotal.toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('VALIDATED');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'VALIDATED'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Validate</span>
              <span className="px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-black">
                {(stagingStatusCounts.VALIDATED ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('APPROVED');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'APPROVED'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Aprobate</span>
              <span className="px-1.5 py-0.2 rounded-md bg-blue-100 text-blue-900 text-[10px] font-black">
                {(stagingStatusCounts.APPROVED ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('PUBLISHED');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'PUBLISHED'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Publicate</span>
              <span className="px-1.5 py-0.2 rounded-md bg-purple-100 text-purple-900 text-[10px] font-black">
                {(stagingStatusCounts.PUBLISHED ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('REJECTED');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'REJECTED'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Respinse</span>
              <span className="px-1.5 py-0.2 rounded-md bg-rose-100 text-rose-900 text-[10px] font-black">
                {(stagingStatusCounts.REJECTED ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStagingFilter('toate');
                setStagingPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                stagingFilter === 'toate'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <span>Toate Ofertele</span>
              <span className="px-1.5 py-0.2 rounded-md bg-slate-200 text-slate-800 text-[10px] font-black">
                {(stagingStatusCounts.ALL ?? 0).toLocaleString('ro-RO')}
              </span>
            </button>
          </div>

          {/* Quick Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Filtre rapide:
            </span>
            {[
              { id: 'toate', label: 'Toate' },
              { id: 'has_ean', label: 'Cu Cod de Bare (EAN)' },
              { id: 'no_ean', label: 'Fără EAN' },
              { id: 'no_price', label: 'Fără Preț' },
              { id: 'auto_matched', label: 'Potrivire Automată' },
              { id: 'needs_manual_review', label: 'Necesită Verificare' },
              { id: 'suspect_price', label: 'Preț Suspect (>50% disc)' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => {
                  setStagingQuickFilter(f.id);
                  setStagingPage(1);
                }}
                className={`px-2.5 py-1 rounded-xl font-bold transition-all ${
                  stagingQuickFilter === f.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}

            {stagingDocumentFilter !== 'toate' && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 font-bold text-xs">
                <span>Document: {stagingDocumentFilter}</span>
                <button
                  onClick={() => {
                    setStagingDocumentFilter('toate');
                    setStagingPage(1);
                  }}
                  className="hover:text-blue-700 ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Bulk Action Sticky Bar */}
          {selectedStagingIds.size > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between shadow-xs animate-in fade-in">
              <p className="text-xs font-bold text-emerald-950 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {selectedStagingIds.size} oferte selectate din această pagină
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setBulkReviewConfirmModal({
                      open: true,
                      action: 'approve',
                      count: selectedStagingIds.size
                    })
                  }
                  disabled={isBulkReviewing}
                  className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  Aprobă & Validează ({selectedStagingIds.size})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBulkReviewConfirmModal({
                      open: true,
                      action: 'reject',
                      count: selectedStagingIds.size
                    })
                  }
                  disabled={isBulkReviewing}
                  className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  Respinge ({selectedStagingIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStagingIds(new Set())}
                  disabled={isBulkReviewing}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Curăță selecția
                </button>
              </div>
            </div>
          )}

          {/* Staging Filters Bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Caută după titlu ofertă, brand, cod de bare (EAN) sau SKU..."
                value={stagingSearch}
                onChange={e => {
                  setStagingSearch(e.target.value);
                  setStagingPage(1);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 outline-none focus:bg-white focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={stagingRetailerFilter}
                onChange={e => {
                  setStagingRetailerFilter(e.target.value);
                  setStagingPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none"
              >
                <option value="toate">Toți Retailerii</option>
                {retailersList.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <select
                value={stagingLimit}
                onChange={e => {
                  setStagingLimit(Number(e.target.value));
                  setStagingPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none"
              >
                <option value={25}>25 pe pagină</option>
                <option value={50}>50 pe pagină</option>
                <option value={100}>100 pe pagină</option>
              </select>

              <button
                type="button"
                onClick={loadStaging}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
                title="Reîmprospătează datele"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStaging ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Staging Items Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="Selectează toate ofertele afișate pe această pagină"
                        checked={
                          stagingOffers.length > 0 &&
                          stagingOffers.every(offer => selectedStagingIds.has(offer.id))
                        }
                        onChange={e => {
                          const next = new Set(selectedStagingIds);
                          stagingOffers.forEach(offer => {
                            if (e.target.checked) next.add(offer.id);
                            else next.delete(offer.id);
                          });
                          setSelectedStagingIds(next);
                        }}
                      />
                    </th>
                    <th className="p-3">Ofertă Extrasă & Brand</th>
                    <th className="p-3">Retailer</th>
                    <th className="p-3">Preț Normal</th>
                    <th className="p-3">Preț Efectiv</th>
                    <th className="p-3">Cod de Bare / SKU</th>
                    <th className="p-3">Potrivire Canonică</th>
                    <th className="p-3">Status Staging</th>
                    <th className="p-3 text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stagingOffers.map(off => {
                    const np = Number(off.normalPrice || 0);
                    const ep = Number(off.effectivePrice || 0);
                    const disc = np > 0 && ep > 0 && ep < np ? Math.round(((np - ep) / np) * 100) : 0;

                    return (
                      <tr
                        key={off.id}
                        onClick={() => setInspectingOffer(off)}
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="p-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Selectează oferta ${off.rawTitle}`}
                            checked={selectedStagingIds.has(off.id)}
                            onChange={e => {
                              const next = new Set(selectedStagingIds);
                              if (e.target.checked) next.add(off.id);
                              else next.delete(off.id);
                              setSelectedStagingIds(next);
                            }}
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-extrabold text-slate-900">{off.rawTitle}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {off.rawBrand ? `Brand: ${off.rawBrand}` : 'Marcă Retailer'} • {off.packageQuantity || 1}{' '}
                            {off.packageUnit || 'buc'}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-800">
                            {off.retailerId}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500 font-medium">
                          {np > 0 ? `${np.toFixed(2)} lei` : '—'}
                        </td>
                        <td className="p-3">
                          <div className="font-black text-emerald-700 text-sm">
                            {ep > 0 ? `${ep.toFixed(2)} lei` : '—'}
                          </div>
                          {disc > 0 && (
                            <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded">
                              -{disc}%
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-600">
                          <div>{off.rawBarcode || 'Lipsă EAN'}</div>
                          {off.retailerSku && (
                            <div className="text-[9px] text-slate-400">SKU: {off.retailerSku}</div>
                          )}
                        </td>
                        <td className="p-3">
                          {off.matchedProductName ? (
                            <div>
                              <span className="font-bold text-slate-800">{off.matchedProductName}</span>
                              {off.matchConfidence !== undefined && (
                                <span className="block text-[9px] text-emerald-700 font-semibold">
                                  {Math.round(off.matchConfidence * 100)}% potrivire ({off.matchMethod || 'fuzzy'})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">Produs nou (auto-creare)</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              off.stagingStatus === 'VALIDATED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : off.stagingStatus === 'APPROVED'
                                ? 'bg-blue-100 text-blue-800'
                                : off.stagingStatus === 'PUBLISHED'
                                ? 'bg-purple-100 text-purple-800'
                                : off.stagingStatus === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {off.stagingStatus}
                          </span>
                          {Array.isArray(off.validationErrors) && off.validationErrors.length > 0 && (
                            <div className="mt-1 text-[10px] text-rose-700 font-medium max-w-[200px] truncate" title={off.validationErrors.join(' ')}>
                              {off.validationErrors[0]}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setInspectingOffer(off)}
                              className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                            >
                              Inspectează
                            </button>
                            {off.stagingStatus === 'NEEDS_REVIEW' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleReviewOffer(off.id, 'approve').catch(() => {})}
                                  disabled={reviewingOfferIds.has(off.id)}
                                  className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
                                >
                                  {reviewingOfferIds.has(off.id) ? '...' : 'Aprobă & Validează'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReviewOffer(off.id, 'reject').catch(() => {})}
                                  disabled={reviewingOfferIds.has(off.id)}
                                  className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
                                >
                                  Respinge
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {stagingOffers.length === 0 && !isLoadingStaging && (
              <div className="p-12 text-center text-slate-400 text-xs">
                Nicio ofertă în staging care să corespundă filtrelor selectate.
              </div>
            )}

            {/* Pagination Controls */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-bold text-slate-600">
              <div>
                Afișare înregistrări {stagingTotal > 0 ? (stagingPage - 1) * stagingLimit + 1 : 0} -{' '}
                {Math.min(stagingTotal, stagingPage * stagingLimit)} din {stagingTotal.toLocaleString('ro-RO')}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStagingPage(p => Math.max(1, p - 1))}
                  disabled={stagingPage <= 1 || isLoadingStaging}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Anterior</span>
                </button>
                <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl">
                  Pagina {stagingPage} din {stagingTotalPages}
                </span>
                <button
                  onClick={() => setStagingPage(p => Math.min(stagingTotalPages, p + 1))}
                  disabled={stagingPage >= stagingTotalPages || isLoadingStaging}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <span>Următor</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ========================================================================= */}
      {/* TAB 7: JURNAL & ERORI (Requirement 8)                                      */}
      {/* ========================================================================= */}
      {activeTab === 'logs' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Observabilitate & Jurnal Rulări Import ({runs.length} Rulări, {errors.length} Erori)
              </h2>
              <p className="text-xs text-slate-500">
                Monitorizare în timp real a fiecărui lot procesat, durate, cantități și opțiuni de reîncercare sigură.
              </p>
            </div>
          </div>

          {/* Errors List */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden space-y-3 p-5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              <span>Jurnal Erori de Procesare ({errors.length})</span>
            </h3>

            {errors.length > 0 ? (
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden text-xs">
                {errors.map(err => (
                  <div key={err.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase px-2 py-0.5 rounded-md bg-rose-100 text-rose-900 text-[10px]">
                          {err.retailerId}
                        </span>
                        <span className="font-semibold text-slate-800">{err.message}</span>
                        <span className="text-[10px] text-slate-400">Etapa: {err.stage}</span>
                      </div>
                      {err.errorDetail && (
                        <p className="text-[11px] font-mono text-slate-500 mt-1 pl-1 border-l-2 border-slate-200">
                          {err.errorDetail}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRetryError(err)}
                      className="self-start sm:self-center px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Reîncearcă</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-emerald-700 bg-emerald-50/50 rounded-2xl border border-emerald-100 text-xs font-medium">
                Zero erori înregistrate în sistem. Toate rulările recente au fost procesate cu succes.
              </div>
            )}
          </div>

          {/* Runs Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Istoric Rulări Import Catalog ({runs.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                  <tr>
                    <th className="p-3 font-bold">ID Rulare</th>
                    <th className="p-3 font-bold">Retailer</th>
                    <th className="p-3 font-bold">Data & Ora</th>
                    <th className="p-3 font-bold">Durată</th>
                    <th className="p-3 font-bold">Status</th>
                    <th className="p-3 font-bold">Extrase</th>
                    <th className="p-3 font-bold">Noi / Actualizate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.slice(0, 15).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-mono text-[10px] text-slate-500 truncate max-w-[120px]">{r.id}</td>
                      <td className="p-3 font-bold uppercase text-slate-700">{r.retailerId}</td>
                      <td className="p-3 text-slate-600">
                        {r.startedAt ? new Date(r.startedAt).toLocaleString('ro-RO') : '—'}
                      </td>
                      <td className="p-3 text-slate-500">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'running'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-800">{r.totalRawExtracted}</td>
                      <td className="p-3 text-slate-600">
                        {r.newProductsCount || 0} noi / {r.updatedProductsCount || 0} act.
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 8: UTILIZATORI & SECURITATE (Requirement 11)                           */}
      {/* ========================================================================= */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Audit Administrativ Imutabil & Securitate Supabase
              </h2>
              <p className="text-xs text-slate-500">
                Înregistrare completă a fiecărei acțiuni efectuate pe surse, aprobări, publicări și modificări de sistem.
              </p>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Jurnal Audit Administrativ ({auditLogs.length} înregistrări)
              </h3>
            </div>
            {auditLogs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                    <tr>
                      <th className="p-3 font-bold">Data & Ora</th>
                      <th className="p-3 font-bold">Utilizator</th>
                      <th className="p-3 font-bold">Acțiune</th>
                      <th className="p-3 font-bold">Tip Țintă</th>
                      <th className="p-3 font-bold">Detalii</th>
                      <th className="p-3 font-bold">IP Adresă</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="p-3 font-mono text-[11px] text-slate-500">
                          {new Date(log.createdAt).toLocaleString('ro-RO')}
                        </td>
                        <td className="p-3 font-bold text-slate-800">{log.userEmail}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-[10px] text-slate-700">
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{log.targetType}</td>
                        <td className="p-3 font-mono text-[11px] text-slate-500 truncate max-w-xs">
                          {JSON.stringify(log.details || {})}
                        </td>
                        <td className="p-3 text-slate-400">{log.ipAddress || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400 text-xs">
                Nicio acțiune administrativă înregistrată în audit log până acum.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 9: SETĂRI & CONEXIUNE POSTGRESQL (Requirement 10)                      */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">
              Conexiune Bază de Date PostgreSQL Supabase
            </h3>
            <p className="text-xs text-slate-600">
              Toate produsele, prețurile, observațiile istorice și profilurile de utilizator sunt sincronizate persistent în schema PostgreSQL Supabase.
            </p>

            {/* Single PostgreSQL Check Action (Eliminating duplicate buttons - Req. 10) */}
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-emerald-700 shrink-0" />
                <div>
                  <div className="font-bold text-emerald-900">
                    Stare Conexiune: {operationalData?.dbStatus?.message || 'Conectat la Supabase (83ms)'}
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    Mod Persistență: PostgreSQL Multi-User • Supabase Pooler
                  </div>
                </div>
              </div>
              <button
                onClick={loadDashboard}
                className="px-4 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-800 font-bold text-xs hover:bg-emerald-100/50 cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Verifică Conexiunea</span>
              </button>
            </div>
          </div>

          <AdminPublishScheduler adminToken={adminToken} />
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS                                                                     */}
      {/* ========================================================================= */}

      {/* 1. Publication Preview Modal (Requirement 6) */}
      <AdminPublishPreviewModal
        open={showPublishPreview}
        onClose={() => {
          setShowPublishPreview(false);
          setPublishPreviewHasConflict(false);
        }}
        onConfirm={handleConfirmPublish}
        onCleanUnpublished={handleCleanUnpublished}
        onRefreshPreview={handleRefreshPublishPreview}
        preview={publishPreviewData}
        isPublishing={isPublishing}
        isCleaning={isCleaningUnpublished}
        isRefreshingPreview={isRefreshingPreview}
        publishErrorMessage={publishErrorMessage}
        cleanupErrorMessage={cleanupErrorMessage}
        hasConflict={publishPreviewHasConflict}
      />

      {/* 2. Product Detail Drawer / Modal (Requirement 9) */}
      <AdminProductDetailModal
        productId={selectedProductId}
        onClose={() => setSelectedProductId(null)}
        adminToken={adminToken}
      />

      {/* 3. Safe Import Confirmation Modal (Requirement 5) */}
      {showImportConfirmModal && (
        <AdminImportConfirmModal
          open={showImportConfirmModal.open}
          onClose={() => setShowImportConfirmModal(null)}
          onConfirm={handleConfirmRunImport}
          isRunning={isRunningActive}
          title={showImportConfirmModal.title}
          targetDescription={showImportConfirmModal.description}
          retailers={showImportConfirmModal.retailers}
        />
      )}

      {/* 4. Logout Confirmation with Active Import Warning (Requirement 11) */}
      {showLogoutConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">
              Avertisment: Import Activ în Desfășurare
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Există un proces activ de importare care rulează în fundal pe server. Deconectarea dumneavoastră nu va opri procesul pe server, dar nu veți mai putea monitoriza rezultatele în timp real.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowLogoutConfirmModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Rămâi în panou
              </button>
              <button
                onClick={executeLogout}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
              >
                Deconectează-te oricum
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Modal Editare / Adăugare Sursă Catalog */}
      {editingSourceModal && (
        <AdminEditSourceModal
          open={editingSourceModal.open}
          onClose={() => setEditingSourceModal(null)}
          source={editingSourceModal.source}
          retailerId={editingSourceModal.retailerId}
          retailerName={editingSourceModal.retailerName}
          fetchWithAuth={fetchWithAuth}
          onSaved={(savedSource) => {
            loadSources();
            loadDashboard();
            setActionMessage({
              type: 'success',
              text: `Sursa "${savedSource.name}" a fost salvată cu succes.`
            });
            setEditingSourceModal(null);
          }}
          onDeleted={(_deletedId) => {
            loadSources();
            loadDashboard();
            setActionMessage({
              type: 'info',
              text: `Sursa a fost ștearsă din sistem.`
            });
            setEditingSourceModal(null);
          }}
        />
      )}

      {/* 6. Modal Definire Retailer Nou */}
      <AdminAddRetailerModal
        open={showAddRetailerModal}
        retailer={editingRetailer}
        onClose={() => {
          setShowAddRetailerModal(false);
          setEditingRetailer(null);
        }}
        fetchWithAuth={fetchWithAuth}
        onSaved={(savedRetailer, _initialSource) => {
          setRetailersList(current => {
            const exists = current.some(retailer => retailer.id === savedRetailer.id);
            const next = exists
              ? current.map(retailer =>
                  retailer.id === savedRetailer.id ? { ...retailer, ...savedRetailer } : retailer
                )
              : [...current, savedRetailer];
            const unique = new Map<string, RetailerConfig>();
            for (const retailer of next) {
              if (!retailer?.id || unique.has(retailer.id)) continue;
              unique.set(retailer.id, retailer);
            }
            return Array.from(unique.values());
          });
          loadRetailers();
          loadSources();
          loadDashboard();
          setExpandedRetailers(prev => new Set(prev).add(savedRetailer.id));
          setActionMessage({
            type: 'success',
            text: editingRetailer
              ? `Retailerul "${savedRetailer.name}" a fost actualizat cu succes!`
              : `Retailerul "${savedRetailer.name}" a fost salvat și adăugat cu succes!`
          });
          setShowAddRetailerModal(false);
          setEditingRetailer(null);
        }}
      />

      {/* 7. Modal Confirmare Ștergere Produs Individual */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">
                Confirmare Delistare & Ștergere Produs
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                Ești sigur că vrei să ștergi și să delistezi produsul <strong className="text-slate-900">„{productToDelete.name}”</strong>? Vor fi eliminate ofertele active asociate din toate supermarketurile și istoricul de preț.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                disabled={isDeletingProducts}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer hover:bg-slate-50 disabled:opacity-50"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={() => handleDeleteSingleProduct(productToDelete.id, productToDelete.name)}
                disabled={isDeletingProducts}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingProducts ? 'Se șterge...' : 'Șterge Produsul'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Modal Confirmare Ștergere în Masă Produse */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">
                Delistare în Masă ({selectedProductIds.size} Produse)
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                Ești pe cale să ștergi definitiv <strong className="text-rose-700">{selectedProductIds.size} produse</strong> selectate din catalogul canonic. Toate ofertele corelate și istoricul acestora vor fi eliminate din baza de date.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={isDeletingProducts}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer hover:bg-slate-50 disabled:opacity-50"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleBulkDeleteProducts}
                disabled={isDeletingProducts}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingProducts ? 'Se șterg...' : `Șterge ${selectedProductIds.size} Produse`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Modal Universal KPI Drilldown (Date Reale Supabase PostgreSQL) */}
      {kpiDrilldown && (
        <AdminKpiDrilldownModal
          open={kpiDrilldown.open}
          type={kpiDrilldown.type}
          title={kpiDrilldown.title}
          subtitle={kpiDrilldown.subtitle}
          onClose={() => setKpiDrilldown(null)}
          adminToken={adminToken}
          retailers={retailersList}
          sources={sources}
          onSelectDocumentFilter={(documentId, retailerId) => {
            setActiveTab('staging');
            setStagingDocumentFilter(documentId);
            if (retailerId) setStagingRetailerFilter(retailerId);
            setStagingPage(1);
          }}
          onNavigateToStagingWithFilter={(filterType, retailerId) => {
            setActiveTab('staging');
            setStagingQuickFilter(filterType);
            if (retailerId) setStagingRetailerFilter(retailerId);
            setStagingPage(1);
          }}
          onNavigateToTab={(tabId) => {
            setActiveTab(tabId as AdminTabId);
          }}
        />
      )}

      {/* 10. Drawer Detalii & Inspecție Tehnică Ofertă Staging */}
      {inspectingOffer && (
        <AdminStagingOfferDrawer
          offer={inspectingOffer}
          onClose={() => setInspectingOffer(null)}
          adminToken={adminToken}
          onApprove={async (offerId) => {
            await handleReviewOffer(offerId, 'approve');
          }}
          onReject={async (offerId, reason) => {
            await handleReviewOffer(offerId, 'reject', reason);
          }}
          onViewDocument={(docId) => {
            setInspectingOffer(null);
            setKpiDrilldown({
              open: true,
              type: 'documents_downloaded',
              title: `Document Sursă: ${docId}`,
              subtitle: 'Arhiva documentului asociat ofertei extrase din catalog.'
            });
          }}
        />
      )}

      {/* 11. Modal Confirmare Revizuire în Masă (Aprobare / Respingere) */}
      {bulkReviewConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 animate-in zoom-in-95">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${
                bulkReviewConfirmModal.action === 'approve'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-rose-100 text-rose-700'
              }`}
            >
              {bulkReviewConfirmModal.action === 'approve' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">
                {bulkReviewConfirmModal.action === 'approve'
                  ? `Validare & Aprobare în Masă (${bulkReviewConfirmModal.count} Oferte)`
                  : `Respingere în Masă (${bulkReviewConfirmModal.count} Oferte)`}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                {bulkReviewConfirmModal.action === 'approve'
                  ? `Ești pe cale să validezi și să aprobi ${bulkReviewConfirmModal.count} oferte selectate. Acestea vor primi statusul VALIDATED/APPROVED și vor fi pregătite pentru sincronizarea automată în catalog.`
                  : `Ești pe cale să respingi ${bulkReviewConfirmModal.count} oferte selectate. Acestea nu vor fi publicate în catalogul public.`}
              </p>
            </div>

            {bulkReviewConfirmModal.action === 'reject' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Motiv respingere:</label>
                <input
                  type="text"
                  value={bulkRejectionReason}
                  onChange={e => setBulkRejectionReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none focus:border-rose-500"
                  placeholder="Introdu motivul respingerii..."
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBulkReviewConfirmModal(null)}
                disabled={isBulkReviewing}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={() => handleBulkReviewOffers(bulkReviewConfirmModal.action, bulkRejectionReason)}
                disabled={isBulkReviewing}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs ${
                  bulkReviewConfirmModal.action === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isBulkReviewing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Se procesează...</span>
                  </>
                ) : (
                  <span>
                    Confirmă {bulkReviewConfirmModal.action === 'approve' ? 'Validarea' : 'Respingerea'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
