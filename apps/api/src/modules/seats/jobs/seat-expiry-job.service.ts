import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Redis } from 'ioredis';

export interface HoldSeatMetadata {
  userId: string;
  heldAt: number;
  expiresAt?: string;
  orderId?: string;
  ticketId?: string;
  hasPendingOrder?: boolean;
  status?: string;
}

export interface CleanupStats {
  scanned: number;
  expired: number;
  protected: number;
  active: number;
}

@Injectable()
export class SeatExpiryJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeatExpiryJobService.name);
  private isRunning = false;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Khôi phục sau sự cố (S-12 AC):
   * Tự động chạy ngay khi ứng dụng vừa khởi động để dọn sạch mọi giữ chỗ tồn đọng trước đó.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Khởi chạy kiểm tra và dọn dẹp giữ chỗ tồn đọng sau khi khởi động hệ thống...');
    try {
      await this.handleSeatExpiryCleanup();
    } catch (error) {
      this.logger.error('Lỗi khi chạy dọn dẹp khởi động:', error);
    }
  }

  /**
   * Cron Job chạy định kỳ mỗi 30 giây (S-12 AC):
   * @Cron('*\/30 * * * * *')
   */
  @Cron('*/30 * * * * *')
  async handleSeatExpiryCleanup(): Promise<CleanupStats> {
    // Ngăn chặn chồng lấn nếu job trước chưa hoàn tất
    if (this.isRunning) {
      this.logger.warn('Job dọn dẹp trước đó vẫn đang chạy, bỏ qua lượt này.');
      return { scanned: 0, expired: 0, protected: 0, active: 0 };
    }

    this.isRunning = true;
    const stats: CleanupStats = {
      scanned: 0,
      expired: 0,
      protected: 0,
      active: 0,
    };

    try {
      // 1. Quét toàn bộ key giữ chỗ theo pattern hold:showtime:*:seat:*
      const keys = await this.scanHoldKeys('hold:showtime:*:seat:*');
      stats.scanned = keys.length;

      if (keys.length === 0) {
        return stats;
      }

      const now = Date.now();

      for (const key of keys) {
        const [ttl, rawData] = await Promise.all([this.redis.ttl(key), this.redis.get(key)]);

        // Nếu key đã biến mất hoặc TTL báo hết hạn (-2: key không tồn tại, -1: không có TTL)
        if (ttl === -2 || !rawData) {
          continue;
        }

        let metadata: HoldSeatMetadata | null = null;
        try {
          metadata = JSON.parse(rawData);
        } catch {
          metadata = null;
        }

        // 2. BẢO VỆ ĐƠN HÀNG (BẮT BUỘC):
        // Nếu giữ chỗ đã được chuyển thành Đơn hàng đang chờ thanh toán (Order / Ticket),
        // Job dọn dẹp KHÔNG ĐƯỢC đụng tới hay xóa ghế đó.
        if (this.isSeatProtectedByOrder(metadata)) {
          stats.protected++;
          this.logger.debug(`Bảo vệ ghế đang gắn với Đơn hàng: ${key}`);
          continue;
        }

        // 3. Kiểm tra tính quá hạn:
        // - Hoặc TTL <= 0
        // - Hoặc thời điểm expiresAt đã qua
        // - Hoặc heldAt đã quá 10 phút (600s * 1000ms)
        const isPastExpiryTime = metadata?.expiresAt
          ? new Date(metadata.expiresAt).getTime() <= now
          : false;

        const isHeldLongerThan10Mins = metadata?.heldAt
          ? now - metadata.heldAt >= 600 * 1000
          : false;

        if (ttl <= 0 || isPastExpiryTime || isHeldLongerThan10Mins) {
          // Xóa an toàn và có tính Idempotent (chạy nhiều lần không gây lỗi)
          await this.redis.del(key);
          stats.expired++;
          this.logger.log(`Đã giải phóng ghế hết hạn: ${key}`);
        } else {
          stats.active++;
        }
      }

      if (stats.expired > 0 || stats.protected > 0) {
        this.logger.log(
          `Hoàn tất dọn dẹp giữ chỗ: Quét ${stats.scanned}, Hết hạn đã xóa ${stats.expired}, Bảo vệ đơn hàng ${stats.protected}, Còn hiệu lực ${stats.active}`,
        );
      }

      return stats;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Kiểm tra xem ghế có được bảo vệ bởi Đơn hàng / Vé đang chờ thanh toán hay không
   */
  isSeatProtectedByOrder(metadata: HoldSeatMetadata | null): boolean {
    if (!metadata) return false;

    // Có mã đơn hàng hoặc vé
    if (metadata.orderId && metadata.orderId.trim()) return true;
    if (metadata.ticketId && metadata.ticketId.trim()) return true;

    // Cờ đánh dấu có đơn hàng đang chờ
    if (metadata.hasPendingOrder === true) return true;

    // Trạng thái đơn hàng đang chờ thanh toán
    if (
      metadata.status === 'PENDING_PAYMENT' ||
      metadata.status === 'ORDER_CREATED' ||
      metadata.status === 'CONFIRMED' ||
      metadata.status === 'PAID'
    ) {
      return true;
    }

    return false;
  }

  /**
   * Quét các key trong Redis bằng SCAN an toàn cho production
   */
  private async scanHoldKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, matchedKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (matchedKeys && matchedKeys.length > 0) {
        keys.push(...matchedKeys);
      }
    } while (cursor !== '0');

    return Array.from(new Set(keys));
  }
}
