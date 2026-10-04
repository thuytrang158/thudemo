import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeatAvailabilityQueryService } from './seat-availability.query.js';
import type { Redis } from 'ioredis';

describe('SeatAvailabilityQueryService (T-28: Expired Hold Query)', () => {
  let service: SeatAvailabilityQueryService;
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      exists: vi.fn().mockResolvedValue(0),
      del: vi.fn().mockResolvedValue(1),
    };

    service = new SeatAvailabilityQueryService(mockRedis as unknown as Redis);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Kiểm thử điều kiện giữ chỗ quá hạn (Core Acceptance Test)', () => {
    it('Một ghế giữ từ 10 phút 01 giây trước (đã quá hạn nhưng chưa xóa trong Redis) BẮT BUỘC trả về trạng thái AVAILABLE', async () => {
      const now = 1791033936000;
      vi.setSystemTime(now);

      const showtimeId = 'st_101';
      const seatId = 'A1';

      // 10 phút 01 giây trước = 601 giây trước
      const heldAt = now - 601 * 1000;
      // expiresAt tính từ lúc giữ (sau 600 giây), nên thời điểm hết hạn là 1 giây trước hiện tại
      const expiresAt = new Date(heldAt + 600 * 1000).toISOString();

      // Giả lập key vẫn còn tồn tại trong Redis do Cron T-27 chưa chạy tới
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'usr_previous_buyer',
          heldAt,
          expiresAt,
        }),
      );

      const status = await service.getSeatStatus(showtimeId, seatId);

      // Yêu cầu cốt lõi của T-28: Ghế quá hạn phải hiển thị là AVAILABLE ngay cho người mua sau
      expect(status).toBe('AVAILABLE');
      // Kiểm tra lazy cleanup giải phóng key quá hạn
      expect(mockRedis.del).toHaveBeenCalledWith(`hold:showtime:${showtimeId}:seat:${seatId}`);
    });
  });

  describe('Kiểm thử các trạng thái ghế khác', () => {
    it('trả về HELD khi ghế được giữ hợp lệ và chưa quá thời hạn 10 phút', async () => {
      const now = 1791033936000;
      vi.setSystemTime(now);

      const showtimeId = 'st_101';
      const seatId = 'A2';

      // Giữ cách đây 2 phút (còn 8 phút nữa mới hết hạn)
      const heldAt = now - 2 * 60 * 1000;
      const expiresAt = new Date(now + 8 * 60 * 1000).toISOString();

      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'usr_current_buyer',
          heldAt,
          expiresAt,
        }),
      );

      const results = await service.getSeatsAvailability(showtimeId, [seatId]);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        seatId: 'A2',
        status: 'HELD',
        heldBy: 'usr_current_buyer',
        expiresAt,
      });
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('trả về AVAILABLE khi ghế hoàn toàn chưa có ai giữ', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const status = await service.getSeatStatus('st_101', 'A3');

      expect(status).toBe('AVAILABLE');
    });

    it('trả về SOLD khi ghế đã được thanh toán hoặc đánh dấu sold', async () => {
      const showtimeId = 'st_101';
      const seatId = 'A4';

      // Ghế có cờ soldKey hoặc metadata status PAID
      mockRedis.exists.mockResolvedValueOnce(1); // sold key exists

      const results = await service.getSeatsAvailability(showtimeId, [seatId]);

      expect(results[0]?.status).toBe('SOLD');
    });

    it('xử lý batch query nhiều ghế với các trạng thái hỗn hợp chính xác', async () => {
      const now = 1791033936000;
      vi.setSystemTime(now);

      const showtimeId = 'st_101';
      const seatIds = ['A1', 'A2', 'A3', 'A4'];

      // A1: Quá hạn 10p01s -> AVAILABLE
      const a1Data = JSON.stringify({
        userId: 'u1',
        heldAt: now - 601 * 1000,
        expiresAt: new Date(now - 1000).toISOString(),
      });
      // A2: Vẫn còn hạn 8 phút -> HELD
      const a2Data = JSON.stringify({
        userId: 'u2',
        heldAt: now - 120 * 1000,
        expiresAt: new Date(now + 480 * 1000).toISOString(),
      });
      // A3: Không có hold -> AVAILABLE
      // A4: Sold -> SOLD

      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes('A1')) return a1Data;
        if (key.includes('A2')) return a2Data;
        if (key.includes('A3')) return null;
        if (key.includes('A4')) return null;
        return null;
      });

      mockRedis.exists.mockImplementation(async (key: string) => {
        if (key.includes('A4')) return 1;
        return 0;
      });

      const results = await service.getSeatsAvailability(showtimeId, seatIds);

      expect(results).toEqual([
        { seatId: 'A1', status: 'AVAILABLE' },
        { seatId: 'A2', status: 'HELD', expiresAt: expect.any(String), heldBy: 'u2' },
        { seatId: 'A3', status: 'AVAILABLE' },
        { seatId: 'A4', status: 'SOLD' },
      ]);
    });
  });
});
