import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface UseSeatHoldTimerOptions {
  expiresAt?: string | number | Date | null;
  onExpire?: () => void;
  /**
   * Nếu true, sẽ khóa mốc expiresAt đầu tiên và bỏ qua các mốc expiresAt mới
   * khi chọn thêm ghế thứ 2, 3 (Multi-seat hold consistency) cho đến khi hết hạn hoặc reset.
   * Mặc định là true.
   */
  lockInitialExpiry?: boolean;
}

export interface UseSeatHoldTimerReturn {
  remainingSeconds: number;
  formattedTime: string;
  isExpired: boolean;
  isWarning: boolean; // Dưới 3 phút (<= 180s)
  isCritical: boolean; // Dưới 1 phút (<= 60s)
  expiresAtTimestamp: number | null;
  resetTimer: (newExpiresAt?: string | number | Date | null) => void;
}

export function formatRemainingTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function parseExpiryTimestamp(expiresAt?: string | number | Date | null): number | null {
  if (!expiresAt) return null;
  const time = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  return isNaN(time) ? null : time;
}

function isOptionsObject(val: unknown): val is UseSeatHoldTimerOptions {
  return (
    val !== null &&
    typeof val === 'object' &&
    !(val instanceof Date) &&
    ('expiresAt' in val || 'onExpire' in val || 'lockInitialExpiry' in val)
  );
}

export function useSeatHoldTimer(
  expiresAtOrOptions?: string | number | Date | null | UseSeatHoldTimerOptions,
  maybeOnExpire?: () => void,
): UseSeatHoldTimerReturn {
  const options: UseSeatHoldTimerOptions = useMemo(() => {
    if (isOptionsObject(expiresAtOrOptions)) {
      return expiresAtOrOptions;
    }
    return {
      expiresAt: expiresAtOrOptions,
      onExpire: maybeOnExpire,
      lockInitialExpiry: true,
    };
  }, [expiresAtOrOptions, maybeOnExpire]);

  const { expiresAt, onExpire } = options;

  const incomingTimestamp = parseExpiryTimestamp(expiresAt);

  // Cho phép can thiệp bằng resetTimer nếu cần
  const [manualTargetTimestamp, setManualTargetTimestamp] = useState<number | null | undefined>(
    undefined,
  );

  const targetTimestamp =
    manualTargetTimestamp !== undefined ? manualTargetTimestamp : incomingTimestamp;

  // Quản lý thời gian thực tế hiện tại để tính remainingSeconds không lệch giờ client
  const [now, setNow] = useState<number>(() => Date.now());

  // Định kỳ cập nhật now qua interval (callback bất đồng bộ)
  useEffect(() => {
    if (!targetTimestamp) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

  // Lưu callback onExpire vào ref để gọi trong effects
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Tính remainingSeconds chống lệch giờ client: Math.max(0, Math.floor((targetTime - Date.now()) / 1000))
  const remainingSeconds = useMemo(() => {
    if (!targetTimestamp) return 0;
    return Math.max(0, Math.floor((targetTimestamp - now) / 1000));
  }, [targetTimestamp, now]);

  // Kích hoạt onExpire khi remainingSeconds về 0
  const hasTriggeredExpireRef = useRef(false);
  useEffect(() => {
    if (targetTimestamp !== null && remainingSeconds === 0) {
      if (!hasTriggeredExpireRef.current) {
        hasTriggeredExpireRef.current = true;
        onExpireRef.current?.();
      }
    } else if (remainingSeconds > 0) {
      hasTriggeredExpireRef.current = false;
    }
  }, [remainingSeconds, targetTimestamp]);

  const resetTimer = useCallback((newExpiresAt?: string | number | Date | null) => {
    const nextTimestamp = parseExpiryTimestamp(newExpiresAt);
    setManualTargetTimestamp(nextTimestamp);
    setNow(Date.now());
  }, []);

  const isExpired = targetTimestamp !== null && remainingSeconds === 0;
  const isWarning = remainingSeconds > 0 && remainingSeconds <= 180; // Dưới 3 phút
  const isCritical = remainingSeconds > 0 && remainingSeconds <= 60; // Dưới 1 phút
  const formattedTime = formatRemainingTime(remainingSeconds);

  return {
    remainingSeconds,
    formattedTime,
    isExpired,
    isWarning,
    isCritical,
    expiresAtTimestamp: targetTimestamp,
    resetTimer,
  };
}
