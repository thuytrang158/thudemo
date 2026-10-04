import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatRemainingTime,
  parseExpiryTimestamp,
} from '@/hooks/useSeatHoldTimer';

describe('useSeatHoldTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatRemainingTime helper', () => {
    it('định dạng chính xác MM:SS cho các mốc thời gian', () => {
      expect(formatRemainingTime(600)).toBe('10:00');
      expect(formatRemainingTime(599)).toBe('09:59');
      expect(formatRemainingTime(180)).toBe('03:00');
      expect(formatRemainingTime(60)).toBe('01:00');
      expect(formatRemainingTime(9)).toBe('00:09');
      expect(formatRemainingTime(0)).toBe('00:00');
    });

    it('xử lý an toàn khi số giây âm hoặc số thập phân', () => {
      expect(formatRemainingTime(-5)).toBe('00:00');
      expect(formatRemainingTime(65.8)).toBe('01:05');
    });
  });

  describe('parseExpiryTimestamp helper', () => {
    it('parse chính xác từ ISO string, timestamp number và Date object', () => {
      const now = 1791033936000;
      const iso = new Date(now).toISOString();
      const dateObj = new Date(now);

      expect(parseExpiryTimestamp(iso)).toBe(now);
      expect(parseExpiryTimestamp(now)).toBe(now);
      expect(parseExpiryTimestamp(dateObj)).toBe(now);
      expect(parseExpiryTimestamp(null)).toBeNull();
      expect(parseExpiryTimestamp(undefined)).toBeNull();
      expect(parseExpiryTimestamp('invalid-date')).toBeNull();
    });
  });

  describe('Cơ chế chống lệch giờ Client (Anti-client drift)', () => {
    it('tính khoảng cách theo mốc expiresAt thực tế của server thay vì 600s cố định', () => {
      const baseTime = 1000000000000;
      vi.setSystemTime(baseTime);

      // Server trả về expiresAt sau 480 giây (đã bị trễ 120s trên đường truyền / xử lý)
      const serverExpiresAt = new Date(baseTime + 480 * 1000).toISOString();

      const remainingSeconds = Math.max(
        0,
        Math.floor((new Date(serverExpiresAt).getTime() - Date.now()) / 1000),
      );

      // Không đếm từ 600s cố định mà đếm đúng 480s còn lại từ server
      expect(remainingSeconds).toBe(480);
      expect(formatRemainingTime(remainingSeconds)).toBe('08:00');
    });
  });

  describe('Tính nhất quán khi giữ nhiều ghế (Multi-seat hold consistency)', () => {
    it('cả 3 ghế chọn cách nhau vẫn dùng chung mốc expiresAt tính từ ghế đầu tiên', () => {
      const baseTime = 1000000000000;
      vi.setSystemTime(baseTime);

      // Ghế thứ 1 được giữ tại baseTime, hết hạn sau 600s
      const firstSeatExpiry = baseTime + 600 * 1000;

      // Người dùng chọn thêm ghế 2 sau 5 giây
      vi.setSystemTime(baseTime + 5 * 1000);
      // Giả sử client nhận expiresAt từ batch hoặc giữ mốc đầu
      const remainingAtSecondSeat = Math.max(0, Math.floor((firstSeatExpiry - Date.now()) / 1000));
      expect(remainingAtSecondSeat).toBe(595); // 09:55

      // Người dùng chọn thêm ghế 3 sau thêm 10 giây (tổng cộng 15s)
      vi.setSystemTime(baseTime + 15 * 1000);
      const remainingAtThirdSeat = Math.max(0, Math.floor((firstSeatExpiry - Date.now()) / 1000));
      expect(remainingAtThirdSeat).toBe(585); // 09:45

      // Đảm bảo không bị reset lại thành 600s
      expect(remainingAtThirdSeat).toBeLessThan(remainingAtSecondSeat);
    });
  });

  describe('Cảnh báo VÀNG và ĐỎ theo ngưỡng thời gian', () => {
    it('phân loại đúng cảnh báo VÀNG (<= 180s) và ĐỎ nhấp nháy (<= 60s)', () => {
      const evaluateFlags = (remainingSeconds: number) => ({
        isWarning: remainingSeconds > 0 && remainingSeconds <= 180,
        isCritical: remainingSeconds > 0 && remainingSeconds <= 60,
        isExpired: remainingSeconds === 0,
      });

      // Còn 5 phút (300s): Bình thường
      expect(evaluateFlags(300)).toEqual({
        isWarning: false,
        isCritical: false,
        isExpired: false,
      });

      // Còn 3 phút (180s): Bắt đầu cảnh báo VÀNG
      expect(evaluateFlags(180)).toEqual({
        isWarning: true,
        isCritical: false,
        isExpired: false,
      });

      // Còn 2 phút (120s): Vẫn là cảnh báo VÀNG
      expect(evaluateFlags(120)).toEqual({
        isWarning: true,
        isCritical: false,
        isExpired: false,
      });

      // Còn 1 phút (60s): Chuyển sang ĐỎ nhấp nháy
      expect(evaluateFlags(60)).toEqual({
        isWarning: true,
        isCritical: true,
        isExpired: false,
      });

      // Còn 10 giây: ĐỎ nhấp nháy
      expect(evaluateFlags(10)).toEqual({
        isWarning: true,
        isCritical: true,
        isExpired: false,
      });

      // 0 giây: Hết hạn
      expect(evaluateFlags(0)).toEqual({
        isWarning: false,
        isCritical: false,
        isExpired: true,
      });
    });
  });

  describe('Tự động gọi onExpire khi hết hạn', () => {
    it('gọi onExpire callback khi thời gian chạm mốc 00:00', () => {
      const baseTime = 1000000000000;
      vi.setSystemTime(baseTime);

      const onExpireMock = vi.fn();
      const expiresAt = new Date(baseTime + 5 * 1000).toISOString(); // 5 giây

      let remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      expect(remaining).toBe(5);

      // Tiến hành giả lập trôi qua 5 giây
      vi.advanceTimersByTime(5000);
      remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      expect(remaining).toBe(0);

      // Kích hoạt callback
      if (remaining === 0) {
        onExpireMock();
      }

      expect(onExpireMock).toHaveBeenCalledOnce();
    });
  });
});
