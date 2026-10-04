import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { SeatHoldService } from './seat-hold.service.js';
import { ISeatValidator } from './interfaces/seat-validator.interface.js';
import { ConflictException, BadRequestException } from '@nestjs/common';
import type { Redis } from 'ioredis';

describe('SeatHoldService', () => {
  let service: SeatHoldService;
  let mockRedis: {
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let mockValidateSeatsExist: Mock<(showtimeId: string, seatIds: string[]) => Promise<boolean>>;
  let mockValidator: ISeatValidator;

  beforeEach(() => {
    mockRedis = {
      set: vi.fn(),
      del: vi.fn(),
      get: vi.fn(),
    };

    mockValidateSeatsExist = vi.fn().mockResolvedValue(true) as unknown as Mock<
      (showtimeId: string, seatIds: string[]) => Promise<boolean>
    >;
    mockValidator = {
      validateSeatsExist: mockValidateSeatsExist,
    };

    service = new SeatHoldService(
      mockRedis as unknown as Redis,
      mockValidator,
    );
  });

  describe('holdSeats - Thành công (Successful Hold)', () => {
    it('giữ thành công nhiều ghế khi không có tranh chấp (all seats acquired)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const params = {
        showtimeId: 'st_101',
        seatIds: ['A1', 'A2', 'A3'],
        userId: 'usr_buyer_123',
      };

      const result = await service.holdSeats(params);

      expect(mockValidateSeatsExist).toHaveBeenCalledWith('st_101', ['A1', 'A2', 'A3']);
      expect(mockRedis.set).toHaveBeenCalledTimes(3);

      // Kiểm tra format key, value và TTL 600s
      expect(mockRedis.set).toHaveBeenNthCalledWith(
        1,
        'hold:showtime:st_101:seat:A1',
        expect.stringContaining('usr_buyer_123'),
        'EX',
        600,
        'NX',
      );
      expect(mockRedis.set).toHaveBeenNthCalledWith(
        2,
        'hold:showtime:st_101:seat:A2',
        expect.stringContaining('usr_buyer_123'),
        'EX',
        600,
        'NX',
      );
      expect(mockRedis.set).toHaveBeenNthCalledWith(
        3,
        'hold:showtime:st_101:seat:A3',
        expect.stringContaining('usr_buyer_123'),
        'EX',
        600,
        'NX',
      );

      expect(mockRedis.del).not.toHaveBeenCalled();

      expect(result).toMatchObject({
        success: true,
        showtimeId: 'st_101',
        heldSeats: ['A1', 'A2', 'A3'],
        expiresInSeconds: 600,
      });
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('holdSeats - Thất bại & Rollback 409 Conflict', () => {
    it('tự động rollback gọi DEL khi ghế A3 bị trùng (Redis trả về null)', async () => {
      // Ghế A1 và A2 thành công ('OK'), ghế A3 bị trùng (null)
      mockRedis.set
        .mockResolvedValueOnce('OK')   // A1
        .mockResolvedValueOnce('OK')   // A2
        .mockResolvedValueOnce(null);  // A3 bị conflict

      const params = {
        showtimeId: 'st_101',
        seatIds: ['A1', 'A2', 'A3'],
        userId: 'usr_buyer_123',
      };

      await expect(service.holdSeats(params)).rejects.toThrow('Ghế A3 đã bị người khác chọn');

      // Đã thử set 3 lần
      expect(mockRedis.set).toHaveBeenCalledTimes(3);

      // Phải rollback xóa A1 và A2 đã giữ trước đó
      expect(mockRedis.del).toHaveBeenCalledOnce();
      expect(mockRedis.del).toHaveBeenCalledWith(
        'hold:showtime:st_101:seat:A1',
        'hold:showtime:st_101:seat:A2',
      );
    });

    it('không gọi DEL nếu ngay ghế đầu tiên A1 đã bị conflict', async () => {
      mockRedis.set.mockResolvedValueOnce(null); // A1 bị conflict ngay

      const params = {
        showtimeId: 'st_101',
        seatIds: ['A1', 'A2'],
        userId: 'usr_buyer_123',
      };

      await expect(service.holdSeats(params)).rejects.toBeInstanceOf(ConflictException);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('holdSeats - Validation ghế không tồn tại (ISeatValidator)', () => {
    it('ném ra BadRequestException khi validator báo ghế không tồn tại', async () => {
      mockValidateSeatsExist.mockResolvedValueOnce(false);

      const params = {
        showtimeId: 'st_101',
        seatIds: ['INVALID_SEAT'],
        userId: 'usr_buyer_123',
      };

      await expect(service.holdSeats(params)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('ném ra BadRequestException khi danh sách ghế rỗng', async () => {
      const params = {
        showtimeId: 'st_101',
        seatIds: [],
        userId: 'usr_buyer_123',
      };

      await expect(service.holdSeats(params)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });
});
