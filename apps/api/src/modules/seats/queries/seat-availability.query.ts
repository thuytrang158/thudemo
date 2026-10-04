import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD';

export interface SeatStatusItem {
  seatId: string;
  status: SeatStatus;
  expiresAt?: string;
  heldBy?: string;
}

export interface HoldMetadata {
  userId: string;
  heldAt: number;
  expiresAt?: string;
  orderId?: string;
  ticketId?: string;
  status?: string;
}

@Injectable()
export class SeatAvailabilityQueryService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private getHoldKey(showtimeId: string, seatId: string): string {
    return `hold:showtime:${showtimeId}:seat:${seatId}`;
  }

  private getSoldKey(showtimeId: string, seatId: string): string {
    return `sold:showtime:${showtimeId}:seat:${seatId}`;
  }

  /**
   * Truy vấn trạng thái của 1 ghế duy nhất
   */
  async getSeatStatus(showtimeId: string, seatId: string): Promise<SeatStatus> {
    const results = await this.getSeatsAvailability(showtimeId, [seatId]);
    return results[0]?.status ?? 'AVAILABLE';
  }

  /**
   * Truy vấn trạng thái danh sách ghế (Task T-28)
   *
   * ĐIỀU KIỆN BẮT BUỘC:
   * Nếu một ghế đang nằm trong danh sách HELD nhưng thời gian expiresAt <= NOW(),
   * hàm query BẮT BUỘC lọc và trả về trạng thái là AVAILABLE (Trống) ngay lập tức.
   */
  async getSeatsAvailability(showtimeId: string, seatIds: string[]): Promise<SeatStatusItem[]> {
    if (!seatIds || seatIds.length === 0) {
      return [];
    }

    const now = Date.now();
    const items: SeatStatusItem[] = [];

    // Lấy dữ liệu hold và sold từ Redis
    for (const seatId of seatIds) {
      const holdKey = this.getHoldKey(showtimeId, seatId);
      const soldKey = this.getSoldKey(showtimeId, seatId);

      const [holdData, isSoldKeyExists] = await Promise.all([
        this.redis.get(holdKey),
        this.redis.exists(soldKey),
      ]);

      // 1. Kiểm tra đã bán (SOLD)
      if (isSoldKeyExists === 1) {
        items.push({ seatId, status: 'SOLD' });
        continue;
      }

      // 2. Không có dữ liệu giữ chỗ -> AVAILABLE
      if (!holdData) {
        items.push({ seatId, status: 'AVAILABLE' });
        continue;
      }

      let metadata: HoldMetadata | null = null;
      try {
        metadata = JSON.parse(holdData);
      } catch {
        metadata = null;
      }

      // Nếu metadata có trạng thái đã bán / hoàn tất đơn hàng
      if (
        metadata?.status === 'PAID' ||
        metadata?.status === 'CONFIRMED' ||
        Boolean(metadata?.ticketId)
      ) {
        items.push({ seatId, status: 'SOLD' });
        continue;
      }

      // 3. XÁC ĐỊNH THỜI ĐIỂM HẾT HẠN (expiresAt)
      let expiryTimestamp: number | null = null;
      if (metadata?.expiresAt) {
        expiryTimestamp = new Date(metadata.expiresAt).getTime();
      } else if (metadata?.heldAt) {
        // Fallback: 10 phút tính từ lúc giữ
        expiryTimestamp = metadata.heldAt + 600 * 1000;
      }

      // 4. KIỂM TRA ĐIỀU KIỆN QUÁ HẠN (T-28 CORE LOGIC):
      // Nếu thời gian expiresAt <= NOW(), BẮT BUỘC coi là AVAILABLE ngay lập tức
      // mà không cần chờ Cron job T-27 quét dọn.
      if (expiryTimestamp !== null && expiryTimestamp <= now) {
        // Lazy cleanup trong background: xóa key quá hạn để giải phóng bộ nhớ
        this.redis.del(holdKey).catch(() => {});

        items.push({
          seatId,
          status: 'AVAILABLE',
        });
        continue;
      }

      // 5. Ghế vẫn đang trong thời hạn giữ chỗ hợp lệ (< 10 phút)
      items.push({
        seatId,
        status: 'HELD',
        expiresAt: metadata?.expiresAt ?? (expiryTimestamp ? new Date(expiryTimestamp).toISOString() : undefined),
        heldBy: metadata?.userId,
      });
    }

    return items;
  }
}
