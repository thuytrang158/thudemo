import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SeatHoldService, HoldSeatsResult } from './seat-hold.service.js';
import { SeatAvailabilityQueryService, SeatStatusItem } from './queries/seat-availability.query.js';
import { HoldSeatsDto } from './dto/hold-seats.dto.js';
import { Public } from '../../auth/decorators/roles.decorator.js';

@Controller(['api/showtimes', 'showtimes'])
export class SeatHoldController {
  constructor(
    private readonly seatHoldService: SeatHoldService,
    private readonly seatAvailabilityQueryService: SeatAvailabilityQueryService,
  ) {}

  @Public()
  @Post(':showtimeId/hold-seats')
  @HttpCode(HttpStatus.CREATED)
  async holdSeats(
    @Param('showtimeId') showtimeId: string,
    @Body() body: HoldSeatsDto,
    @Request() req: any,
  ): Promise<HoldSeatsResult> {
    HoldSeatsDto.validate(body);

    // Mockup userId từ Header/Body hoặc mặc định usr_mock_123 nếu chưa có Auth từ T-19
    const userId =
      req?.user?.id ||
      body.userId ||
      (req?.headers ? (req.headers['x-user-id'] as string) : undefined) ||
      'usr_mock_123';

    return this.seatHoldService.holdSeats({
      showtimeId,
      seatIds: body.seatIds,
      userId,
    });
  }

  /**
   * Truy vấn trạng thái ghế của suất chiếu (T-28)
   * Tự động lọc các ghế hết hạn và trả về AVAILABLE ngay lập tức
   */
  @Public()
  @Get(':showtimeId/seats')
  async getSeatsAvailability(
    @Param('showtimeId') showtimeId: string,
    @Query('seatIds') seatIdsQuery?: string,
  ): Promise<SeatStatusItem[]> {
    const seatIds = seatIdsQuery
      ? seatIdsQuery.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    return this.seatAvailabilityQueryService.getSeatsAvailability(showtimeId, seatIds);
  }
}
