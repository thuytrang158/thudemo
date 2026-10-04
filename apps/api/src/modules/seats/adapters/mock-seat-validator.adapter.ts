import { Injectable } from '@nestjs/common';
import { ISeatValidator } from '../interfaces/seat-validator.interface.js';

// TODO: Thay bằng T19SeatStatusAdapter khi T-19 được merge vào main
@Injectable()
export class MockSeatValidatorAdapter implements ISeatValidator {
  async validateSeatsExist(_showtimeId: string, _seatIds: string[]): Promise<boolean> {
    // Tạm thời luôn return true để mockup kết quả cho T-19
    return true;
  }
}
