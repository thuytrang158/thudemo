import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';

describe('SeatHoldApi (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  const showtimeId = 'st_101';
  const seatA1Key = `hold:showtime:${showtimeId}:seat:A1`;
  const seatA2Key = `hold:showtime:${showtimeId}:seat:A2`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    redis = app.get<Redis>('REDIS_CLIENT');
    // Dọn dẹp key test trước khi chạy
    await redis.del(seatA1Key, seatA2Key);
  });

  afterAll(async () => {
    // Dọn dẹp key sau khi test xong
    if (redis) {
      await redis.del(seatA1Key, seatA2Key);
    }
    await app.close();
  });

  it('Test case 1: Giữ 2 ghế A1, A2 thành công (HTTP 201 Created)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/showtimes/${showtimeId}/hold-seats`)
      .send({ seatIds: ['A1', 'A2'] })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      showtimeId,
      heldSeats: ['A1', 'A2'],
      expiresInSeconds: 600,
    });

    expect(response.body.expiresAt).toBeDefined();
    const expiryTime = new Date(response.body.expiresAt).getTime();
    expect(expiryTime).toBeGreaterThan(Date.now());

    // Xác nhận key đã được lưu vào Redis và có TTL hợp lệ
    const a1Holder = await redis.get(seatA1Key);
    const a2Holder = await redis.get(seatA2Key);
    const ttlA1 = await redis.ttl(seatA1Key);

    expect(a1Holder).toBeDefined();
    expect(a2Holder).toBeDefined();
    expect(ttlA1).toBeGreaterThan(0);
    expect(ttlA1).toBeLessThanOrEqual(600);
  });

  it('Test case 2: Giữ lại ghế A1 bị từ chối 409 Conflict', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/showtimes/${showtimeId}/hold-seats`)
      .send({ seatIds: ['A1'] })
      .expect(409);

    expect(response.body.message).toContain('Ghế A1 đã bị người khác chọn');
  });
});
