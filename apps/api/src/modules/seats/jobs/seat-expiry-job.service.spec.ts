import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeatExpiryJobService } from './seat-expiry-job.service.js';
import type { Redis } from 'ioredis';

describe('SeatExpiryJobService', () => {
  let service: SeatExpiryJobService;
  let mockRedis: {
    scan: ReturnType<typeof vi.fn>;
    ttl: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRedis = {
      scan: vi.fn(),
      ttl: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    };

    service = new SeatExpiryJobService(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Dọn dẹp ghế hết hạn (Expired Seats Cleanup)', () => {
    it('quét và xóa đúng các ghế đã quá thời hạn 10 phút hoặc TTL <= 0', async () => {
      const now = Date.now();
      const expiredKey = 'hold:showtime:st_101:seat:A1';
      const activeKey = 'hold:showtime:st_101:seat:A2';

      mockRedis.scan.mockResolvedValueOnce(['0', [expiredKey, activeKey]]);

      // A1: Đã hết hạn (heldAt cách đây 15 phút)
      mockRedis.ttl.mockImplementation(async (key: string) => {
        if (key === expiredKey) return -1;
        return 300; // A2 còn 300s
      });

      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === expiredKey) {
          return JSON.stringify({
            userId: 'usr_old',
            heldAt: now - 15 * 60 * 1000,
            expiresAt: new Date(now - 5 * 60 * 1000).toISOString(),
          });
        }
        return JSON.stringify({
          userId: 'usr_active',
          heldAt: now - 60 * 1000,
          expiresAt: new Date(now + 300 * 1000).toISOString(),
        });
      });

      mockRedis.del.mockResolvedValue(1);

      const stats = await service.handleSeatExpiryCleanup();

      expect(stats.scanned).toBe(2);
      expect(stats.expired).toBe(1);
      expect(stats.protected).toBe(0);
      expect(stats.active).toBe(1);

      // Đảm bảo chỉ xóa ghế hết hạn A1, không xóa A2
      expect(mockRedis.del).toHaveBeenCalledWith(expiredKey);
      expect(mockRedis.del).not.toHaveBeenCalledWith(activeKey);
    });
  });

  describe('Bảo vệ Đơn hàng (Order Protection - BẮT BUỘC)', () => {
    it('KHÔNG ĐƯỢC xóa ghế đã chuyển thành Đơn hàng/Vé đang chờ thanh toán dù đã quá hạn', async () => {
      const now = Date.now();
      const orderBoundKey = 'hold:showtime:st_101:seat:B1';
      const normalExpiredKey = 'hold:showtime:st_101:seat:B2';

      mockRedis.scan.mockResolvedValueOnce(['0', [orderBoundKey, normalExpiredKey]]);

      mockRedis.ttl.mockResolvedValue(-1);

      // B1 đã gắn orderId / status PENDING_PAYMENT
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === orderBoundKey) {
          return JSON.stringify({
            userId: 'usr_buyer',
            heldAt: now - 20 * 60 * 1000,
            expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
            orderId: 'ord_pending_999',
            status: 'PENDING_PAYMENT',
          });
        }
        return JSON.stringify({
          userId: 'usr_expired',
          heldAt: now - 20 * 60 * 1000,
          expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
        });
      });

      mockRedis.del.mockResolvedValue(1);

      const stats = await service.handleSeatExpiryCleanup();

      expect(stats.scanned).toBe(2);
      expect(stats.protected).toBe(1);
      expect(stats.expired).toBe(1);

      // KHÔNG ĐƯỢC đụng tới ghế B1
      expect(mockRedis.del).not.toHaveBeenCalledWith(orderBoundKey);
      // Ghế B2 không gắn order nên bị xóa bình thường
      expect(mockRedis.del).toHaveBeenCalledWith(normalExpiredKey);
    });

    it('bảo vệ ghế khi metadata có ticketId hoặc cờ hasPendingOrder', () => {
      expect(service.isSeatProtectedByOrder({ userId: 'u1', heldAt: 1, orderId: 'ord_1' })).toBe(true);
      expect(service.isSeatProtectedByOrder({ userId: 'u1', heldAt: 1, ticketId: 'tkt_1' })).toBe(true);
      expect(service.isSeatProtectedByOrder({ userId: 'u1', heldAt: 1, hasPendingOrder: true })).toBe(true);
      expect(service.isSeatProtectedByOrder({ userId: 'u1', heldAt: 1, status: 'ORDER_CREATED' })).toBe(true);
      expect(service.isSeatProtectedByOrder({ userId: 'u1', heldAt: 1 })).toBe(false);
      expect(service.isSeatProtectedByOrder(null)).toBe(false);
    });
  });

  describe('Tính Idempotent & Khôi phục sau sự cố (S-12 AC)', () => {
    it('chạy lặp đi lặp lại nhiều lần trên cùng dữ liệu mà kết quả không đổi', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      // Lần 1: Không có key
      const stats1 = await service.handleSeatExpiryCleanup();
      expect(stats1).toEqual({ scanned: 0, expired: 0, protected: 0, active: 0 });

      // Lần 2: Chạy lại ngay lập tức vẫn an toàn
      const stats2 = await service.handleSeatExpiryCleanup();
      expect(stats2).toEqual({ scanned: 0, expired: 0, protected: 0, active: 0 });
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('onApplicationBootstrap tự động gọi dọn dẹp ngay sau khi khởi động', async () => {
      const cleanupSpy = vi.spyOn(service, 'handleSeatExpiryCleanup').mockResolvedValue({
        scanned: 0,
        expired: 0,
        protected: 0,
        active: 0,
      });

      await service.onApplicationBootstrap();

      expect(cleanupSpy).toHaveBeenCalledOnce();
    });
  });
});
