import { BadRequestException } from '@nestjs/common';

export class HoldSeatsDto {
  seatIds!: string[];
  userId?: string;

  static validate(dto: unknown): asserts dto is HoldSeatsDto {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Request body must be an object');
    }

    const candidate = dto as Partial<HoldSeatsDto>;

    if (!candidate.seatIds || !Array.isArray(candidate.seatIds) || candidate.seatIds.length === 0) {
      throw new BadRequestException('seatIds must be a non-empty array of seat identifiers');
    }

    for (const seatId of candidate.seatIds) {
      if (typeof seatId !== 'string' || !seatId.trim()) {
        throw new BadRequestException('Each seatId must be a non-empty string');
      }
    }

    if (candidate.userId !== undefined && (typeof candidate.userId !== 'string' || !candidate.userId.trim())) {
      throw new BadRequestException('userId must be a string if provided');
    }
  }
}
