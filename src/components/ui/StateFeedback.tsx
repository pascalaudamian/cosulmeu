import React from 'react';
import {
  AlertTriangle,
  CalendarX,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import type { PriceDataQualityStatus } from '../../types.js';
import { getQualityStatusDisplay } from '../../styles/designTokens.js';

export interface LoadingStateProps {
  message?: string;
  variant?: 'inline' | 'card' | 'skeleton-grid';
  cardsCount?: number;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Se încarcă datele...',
  variant = 'card',
  cardsCount = 4,
  className = ''
}) => {
  if (variant === 'skeleton-grid') {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}
      >
        <span className="sr-only">{message}</span>
        {Array.from({ length: cardsCount }).map((_, idx) => (
          <div key={idx} className="surface-card p-4 space-y-3">
            <div className="h-28 w-full rounded-xl bg-slate-100 dark:bg-slate-800/80 animate-pulse" />
            <div className="h-4 w-3/4 rounded-md bg-slate-100 dark:bg-slate-800/80 animate-pulse" />
            <div className="h-3 w-1/2 rounded-md bg-slate-100 dark:bg-slate-800/80 animate-pulse" />
            <div className="h-9 w-full rounded-xl bg-slate-100 dark:bg-slate-800/80 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={`inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 ${className}`}
      >
        <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`surface-card p-8 sm:p-10 text-center flex flex-col items-center justify-center gap-3 ${className}`}
    >
      <Loader2 className="w-7 h-7 animate-spin text-emerald-600 dark:text-emerald-400" />
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{message}</p>
    </div>
  );
};

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = ''
}) => {
  return (
    <div className={`surface-card p-6 sm:p-10 text-center flex flex-col items-center justify-center gap-3 ${className}`}>
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="space-y-1 max-w-md">
        <h3 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        {description && (
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="ds-btn ds-btn-primary text-xs mt-1">
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export interface ErrorStateProps {
  variant?: 'network' | 'offline' | 'partial' | 'unauthorized' | 'generic';
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  compact?: boolean;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  variant = 'generic',
  title,
  message,
  onRetry,
  retryLabel = 'Reîncearcă',
  onDismiss,
  compact = false,
  className = ''
}) => {
  const isWarning = variant === 'partial' || variant === 'offline';
  const Icon =
    variant === 'offline'
      ? WifiOff
      : variant === 'unauthorized'
      ? Lock
      : AlertTriangle;

  const containerStyle = isWarning
    ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
    : 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100';

  const iconColor = isWarning
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-600 dark:text-rose-400';

  return (
    <div
      role="alert"
      className={`rounded-2xl border ${containerStyle} ${
        compact ? 'px-3.5 py-2.5 text-xs' : 'p-4 sm:p-5 text-sm'
      } flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
        <div className="min-w-0 space-y-0.5">
          {title && <p className="font-bold">{title}</p>}
          <p className="leading-snug opacity-95">{message}</p>
        </div>
      </div>
      {(onRetry || onDismiss) && (
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                isWarning
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{retryLabel}</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Închide mesajul"
              className="min-h-[36px] px-2.5 py-1 rounded-xl text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              Închide
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export interface QualityStatusBadgeProps {
  status?: PriceDataQualityStatus | null;
  labelOverrideRo?: string;
  showTooltip?: boolean;
  compact?: boolean;
  className?: string;
}

export const QualityStatusBadge: React.FC<QualityStatusBadgeProps> = ({
  status,
  labelOverrideRo,
  showTooltip = true,
  compact = false,
  className = ''
}) => {
  const token = getQualityStatusDisplay(status);
  const label = labelOverrideRo || token.labelRo;

  const renderIcon = () => {
    const cls = compact ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0';
    switch (token.iconName) {
      case 'shield-check':
        return <ShieldCheck className={cls} aria-hidden="true" />;
      case 'check-circle':
        return <CheckCircle2 className={cls} aria-hidden="true" />;
      case 'clock':
        return <Clock className={cls} aria-hidden="true" />;
      case 'calendar-x':
        return <CalendarX className={cls} aria-hidden="true" />;
      case 'alert-triangle':
        return <AlertTriangle className={cls} aria-hidden="true" />;
      default:
        return <HelpCircle className={cls} aria-hidden="true" />;
    }
  };

  return (
    <span
      title={showTooltip ? `${label}: ${token.shortDescRo}` : undefined}
      className={`inline-flex items-center gap-1 rounded-lg border font-semibold ${
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'
      } ${token.badgeClass} ${className}`}
    >
      {renderIcon()}
      <span>{label}</span>
    </span>
  );
};
