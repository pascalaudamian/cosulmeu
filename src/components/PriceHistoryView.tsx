import React, { useState, useMemo } from 'react';
import {
  TrendingDown,
  TrendingUp,
  LineChart,
  Bell,
  Eye,
  Search,
  Plus,
  Trash2,
  Calendar,
  Check,
  Store,
  ArrowRight,
  Filter,
  CheckCircle2
} from 'lucide-react';
import { Product, PriceAlert } from '../types';
import { StorageService } from '../services/StorageService';
import { PriceHistoryService, ProductPriceStats } from '../services/PriceHistoryService';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { PRODUCTS, STORES } from '../data/mockData';

interface PriceHistoryViewProps {
  alerts: PriceAlert[];
  onUpdateAlerts: (alerts: PriceAlert[]) => void;
  onSelectProductForDetails?: (product: Product) => void;
}

export const PriceHistoryView: React.FC<PriceHistoryViewProps> = ({
  alerts,
  onUpdateAlerts,
  onSelectProductForDetails
}) => {
  const [selectedProductId, setSelectedProductId] = useState<string>('prod-lapte-1');
  const [timeframeDays, setTimeframeDays] = useState<number>(90); // 30, 90, 365
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddAlertModal, setShowAddAlertModal] = useState<boolean>(false);
  const [targetAlertPrice, setTargetAlertPrice] = useState<number>(6.00);

  const allProducts = useMemo(() => StorageService.getAllProducts(), []);
  const trackedProductIds = useMemo(() => StorageService.getTrackedProducts(), []);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    return allProducts.filter(
      p =>
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.brand.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allProducts, searchQuery]);

  // Selected product and stats
  const selectedProduct = allProducts.find(p => p.id === selectedProductId) || allProducts[0];
  const stats: ProductPriceStats = useMemo(() => {
    return PriceHistoryService.getProductPriceStats(selectedProduct.id);
  }, [selectedProduct.id]);

  // Timeline points filtered by timeframe
  const filteredTimeline = useMemo(() => {
    return PriceHistoryService.filterPointsByDays(stats.historyPoints, timeframeDays);
  }, [stats.historyPoints, timeframeDays]);

  // Handle toggle tracked product
  const [trackedList, setTrackedList] = useState<string[]>(trackedProductIds);
  const handleToggleTracked = (productId: string) => {
    const isNowTracked = StorageService.toggleTrackedProduct(productId);
    setTrackedList(StorageService.getTrackedProducts());
  };

  // Handle add price alert
  const handleSaveAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetAlertPrice <= 0) return;

    const newAlert: PriceAlert = {
      id: `alt-${Date.now()}`,
      productId: selectedProduct.id,
      productName: `${selectedProduct.name} (${selectedProduct.brand})`,
      targetPrice: targetAlertPrice,
      currentLowestPrice: stats.currentLowestPrice,
      lowestStoreId: stats.currentLowestStoreName,
      createdAt: new Date().toISOString().split('T')[0],
      isActive: true
    };

    const updated = [newAlert, ...alerts];
    onUpdateAlerts(updated);
    StorageService.savePriceAlerts(updated);
    setShowAddAlertModal(false);
  };

  const handleDeleteAlert = (alertId: string) => {
    const updated = alerts.filter(a => a.id !== alertId);
    onUpdateAlerts(updated);
    StorageService.savePriceAlerts(updated);
  };

  // SVG Chart Calculation
  const chartWidth = 600;
  const chartHeight = 220;
  const padding = { top: 25, right: 30, bottom: 35, left: 55 };

  const prices = filteredTimeline.map(p => p.price);
  const minPrice = Math.min(...prices, stats.minRecordedPrice) * 0.95;
  const maxPrice = Math.max(...prices, stats.maxRecordedPrice) * 1.05;

  const getX = (index: number) => {
    if (filteredTimeline.length <= 1) return chartWidth / 2;
    return (
      padding.left +
      (index / (filteredTimeline.length - 1)) * (chartWidth - padding.left - padding.right)
    );
  };

  const getY = (price: number) => {
    if (maxPrice === minPrice) return chartHeight / 2;
    const ratio = (price - minPrice) / (maxPrice - minPrice);
    return chartHeight - padding.bottom - ratio * (chartHeight - padding.top - padding.bottom);
  };

  const polylinePoints = filteredTimeline
    .map((p, i) => `${getX(i)},${getY(p.price)}`)
    .join(' ');

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Istoricul & Evoluția Prețurilor 📈
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Monitorizează fluctuațiile de preț în supermarketuri și setează alerte automate la reduceri.
          </p>
        </div>

        <button
          onClick={() => {
            setTargetAlertPrice(Math.round((stats.currentLowestPrice * 0.9) * 10) / 10);
            setShowAddAlertModal(true);
          }}
          className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all"
        >
          <Bell className="w-4 h-4" />
          Setează alertă de preț
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Product Selector List (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col h-[600px]">
          <div className="mb-3">
            <h3 className="font-bold text-sm text-slate-900 mb-2">Alege un produs</h3>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Caută în catalog..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 overflow-y-auto flex-1 pr-1">
            {filteredProducts.map(p => {
              const isSelected = p.id === selectedProduct.id;
              const isTracked = trackedList.includes(p.id);

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className={`p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-emerald-50 text-emerald-950 font-semibold'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-xs sm:text-sm block truncate">{p.name}</span>
                    <span className="text-[11px] text-slate-400 block truncate">
                      {p.brand} • {p.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleToggleTracked(p.id);
                      }}
                      className={`p-1.5 rounded-lg text-xs ${
                        isTracked ? 'text-emerald-600 bg-emerald-100/60' : 'text-slate-300 hover:text-slate-600'
                      }`}
                      title={isTracked ? 'Urmărești acest produs' : 'Urmărește produsul'}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Interactive Price Chart & Statistics (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Product Header & Overview Card */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-1">
                  {selectedProduct.category}
                </span>
                <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  {selectedProduct.name}
                </h2>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{selectedProduct.brand}</span>
                  <span>• Unitate de referință: 1 {selectedProduct.normalizedUnit}</span>
                  {selectedProduct.barcode && <span>• EAN: {selectedProduct.barcode}</span>}
                </div>
              </div>

              {/* Timeframe Selector */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
                <button
                  onClick={() => setTimeframeDays(30)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                    timeframeDays === 30 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  30 zile
                </button>
                <button
                  onClick={() => setTimeframeDays(90)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                    timeframeDays === 90 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  90 zile
                </button>
                <button
                  onClick={() => setTimeframeDays(365)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                    timeframeDays === 365 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  1 an
                </button>
              </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] text-slate-500 font-medium block">Preț minim curent</span>
                <span className="text-lg sm:text-xl font-black text-emerald-600 mt-0.5 block">
                  {PriceComparisonService.formatRon(stats.currentLowestPrice)}
                </span>
                <span className="text-[10px] text-slate-400 truncate block">la {stats.currentLowestStoreName}</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] text-slate-500 font-medium block">Preț mediu</span>
                <span className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 block">
                  {PriceComparisonService.formatRon(stats.averagePrice)}
                </span>
                <span className="text-[10px] text-slate-400 block">în ultimele luni</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] text-slate-500 font-medium block">Maxim înregistrat</span>
                <span className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 block">
                  {PriceComparisonService.formatRon(stats.maxRecordedPrice)}
                </span>
                <span className="text-[10px] text-slate-400 block">vârf istoric</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] text-slate-500 font-medium block">Ultimul preț plătit</span>
                <span className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 block">
                  {stats.lastPaidPrice ? PriceComparisonService.formatRon(stats.lastPaidPrice) : 'N/A'}
                </span>
                <span className="text-[10px] text-slate-400 truncate block">
                  {stats.lastPaidStoreName ? `pe bon la ${stats.lastPaidStoreName}` : 'nescanat încă'}
                </span>
              </div>
            </div>

            {/* Interactive SVG Chart */}
            <div className="mt-6 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <LineChart className="w-4 h-4 text-emerald-600" />
                  Grafic evoluție preț (RON)
                </span>
                {stats.trendPercentage !== 0 && (
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      stats.trendPercentage < 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {stats.trendPercentage < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingUp className="w-3.5 h-3.5" />
                    )}
                    {stats.trendPercentage > 0 ? `+${stats.trendPercentage}%` : `${stats.trendPercentage}%`}
                  </span>
                )}
              </div>

              {filteredTimeline.length < 2 ? (
                <div className="h-48 flex items-center justify-center text-xs text-slate-400 text-center">
                  Nu există încă suficiente observații istorice pentru un grafic pe această perioadă. Scanează mai multe bonuri!
                </div>
              ) : (
                <div className="relative overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-56 overflow-visible"
                  >
                    {/* Horizontal grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                      const priceVal = minPrice + (maxPrice - minPrice) * (1 - pct);
                      const y = padding.top + pct * (chartHeight - padding.top - padding.bottom);
                      return (
                        <g key={i}>
                          <line
                            x1={padding.left}
                            y1={y}
                            x2={chartWidth - padding.right}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={padding.left - 8}
                            y={y + 3}
                            textAnchor="end"
                            fontSize="10"
                            fill="#94a3b8"
                            fontWeight="500"
                          >
                            {priceVal.toFixed(2)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Gradient Fill under line */}
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Area under line */}
                    <polygon
                      points={`${getX(0)},${chartHeight - padding.bottom} ${polylinePoints} ${getX(
                        filteredTimeline.length - 1
                      )},${chartHeight - padding.bottom}`}
                      fill="url(#chartGradient)"
                    />

                    {/* Main Trend Line */}
                    <polyline
                      fill="none"
                      stroke="#059669"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={polylinePoints}
                    />

                    {/* Data Points */}
                    {filteredTimeline.map((p, i) => {
                      const cx = getX(i);
                      const cy = getY(p.price);
                      return (
                        <g key={i} className="group cursor-pointer">
                          <circle
                            cx={cx}
                            cy={cy}
                            r="5"
                            className="fill-white stroke-emerald-600 stroke-2 hover:r-7 transition-all"
                          />
                          {/* Point label */}
                          <text
                            x={cx}
                            y={chartHeight - 12}
                            textAnchor="middle"
                            fontSize="9"
                            fill="#64748b"
                          >
                            {p.date.split('-').slice(1).join('/')}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Active Price Alerts for this or other products */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Alerte de preț active ({alerts.length})</h3>
              </div>
              <button
                onClick={() => setShowAddAlertModal(true)}
                className="text-xs font-semibold text-emerald-600 hover:underline"
              >
                + Adaugă alertă
              </button>
            </div>

            {alerts.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nu ai nicio alertă configurată. Setează o alertă pentru a fi anunțat când un produs scade sub prețul dorit.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    className="p-3.5 rounded-2xl border border-emerald-100 bg-emerald-50/40 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-xs text-slate-800 block line-clamp-1">
                        {alert.productName}
                      </span>
                      <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-2">
                        <span>Preț țintă: <strong className="text-emerald-700">{PriceComparisonService.formatRon(alert.targetPrice)}</strong></span>
                        <span>• Acum: {PriceComparisonService.formatRon(alert.currentLowestPrice)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteAlert(alert.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-md"
                      title="Șterge alerta"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Alert Modal */}
      {showAddAlertModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-base font-bold text-slate-900">
              Setează o alertă de preț
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Pentru: <strong className="text-slate-800">{selectedProduct.name}</strong>
            </p>

            <form onSubmit={handleSaveAlert} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Preț țintă dorit (lei)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={targetAlertPrice}
                    onChange={e => setTargetAlertPrice(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:border-emerald-500"
                  />
                  <span className="absolute right-3 top-3 text-xs text-slate-400 font-bold">RON</span>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Prețul minim actual este de {PriceComparisonService.formatRon(stats.currentLowestPrice)}.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddAlertModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-xs"
                >
                  Salvează alerta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
