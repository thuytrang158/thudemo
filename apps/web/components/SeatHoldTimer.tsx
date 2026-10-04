'use client';

import React from 'react';
import { useSeatHoldTimer } from '../hooks/useSeatHoldTimer';

export interface SeatHoldTimerProps {
  expiresAt: string | number | Date | null | undefined;
  onExpire?: () => void;
  className?: string;
  showIcon?: boolean;
  label?: string;
}

export const SeatHoldTimer: React.FC<SeatHoldTimerProps> = ({
  expiresAt,
  onExpire,
  className = '',
  showIcon = true,
  label = 'Thời gian giữ ghế:',
}) => {
  const { remainingSeconds, formattedTime, isExpired, isWarning, isCritical } =
    useSeatHoldTimer(expiresAt, onExpire);

  if (!expiresAt) {
    return null;
  }

  // Quyết định trạng thái style cảnh báo
  let statusClasses = 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-600/40';
  let badgeClasses = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300';
  let pulseAnimation = false;

  if (isExpired) {
    statusClasses = 'border-zinc-400 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-600';
    badgeClasses = 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300';
  } else if (isCritical) {
    // Dưới 1 phút: Màu đỏ + nhấp nháy (blink/pulse)
    statusClasses = 'border-red-500 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 dark:border-red-500 animate-pulse';
    badgeClasses = 'bg-red-100 text-red-700 dark:bg-red-900/80 dark:text-red-200';
    pulseAnimation = true;
  } else if (isWarning) {
    // Dưới 3 phút: Màu vàng cảnh báo
    statusClasses = 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-500/50';
    badgeClasses = 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200';
  }

  return (
    <div
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      data-testid="seat-hold-timer"
      data-remaining-seconds={remainingSeconds}
      data-state={isExpired ? 'expired' : isCritical ? 'critical' : isWarning ? 'warning' : 'normal'}
      className={`inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border text-sm font-medium transition-colors duration-300 shadow-sm ${statusClasses} ${className}`}
      style={{
        // Inline styles đảm bảo màu sắc và hiệu ứng hoạt động ngay cả khi Tailwind purge
        borderColor: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : isExpired ? '#9ca3af' : undefined,
        color: isCritical ? '#dc2626' : isWarning ? '#d97706' : isExpired ? '#4b5563' : undefined,
      }}
    >
      {showIcon && (
        <span
          className={`flex items-center justify-center ${pulseAnimation ? 'animate-bounce' : ''}`}
          aria-hidden="true"
        >
          ⏱️
        </span>
      )}

      {label && <span className="opacity-90">{label}</span>}

      <span
        data-testid="seat-hold-time-display"
        className={`font-mono text-base font-bold tracking-wider px-2 py-0.5 rounded ${badgeClasses}`}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {formattedTime}
      </span>

      {isExpired && (
        <span className="text-xs font-semibold uppercase tracking-wide ml-1 text-red-600">
          (Đã hết hạn)
        </span>
      )}
    </div>
  );
};

export default SeatHoldTimer;
