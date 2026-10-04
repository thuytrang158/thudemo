import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SeatHoldService } from './seat-hold.service.js';
import { SeatHoldController } from './seat-hold.controller.js';
import { SEAT_VALIDATOR } from './interfaces/seat-validator.interface.js';
import { MockSeatValidatorAdapter } from './adapters/mock-seat-validator.adapter.js';
import { SeatExpiryJobService } from './jobs/seat-expiry-job.service.js';
import { SeatAvailabilityQueryService } from './queries/seat-availability.query.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SeatHoldController],
  providers: [
    SeatHoldService,
    SeatExpiryJobService,
    SeatAvailabilityQueryService,
    {
      provide: SEAT_VALIDATOR,
      useClass: MockSeatValidatorAdapter,
    },
  ],
  exports: [SeatHoldService, SeatExpiryJobService, SeatAvailabilityQueryService, SEAT_VALIDATOR],
})
export class SeatsModule {}
