export const SEAT_VALIDATOR = 'ISeatValidator';

export interface ISeatValidator {
  validateSeatsExist(showtimeId: string, seatIds: string[]): Promise<boolean>;
}
