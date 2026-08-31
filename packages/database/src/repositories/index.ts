import { addressRepository } from './address-repository.js';
import { availabilityRepository } from './availability-repository.js';
import { bookingRepository } from './booking-repository.js';
import { catalogRepository } from './catalog-repository.js';
import { technicianRepository } from './technician-repository.js';
import { userRepository } from './user-repository.js';

/**
 * Aggregated data-access layer. Application services depend on this object;
 * they never import Prisma or the generated client directly.
 */
export const repositories = {
  addresses: addressRepository,
  availability: availabilityRepository,
  bookings: bookingRepository,
  catalog: catalogRepository,
  technicians: technicianRepository,
  users: userRepository,
};

export {
  addressRepository,
  availabilityRepository,
  bookingRepository,
  catalogRepository,
  technicianRepository,
  userRepository,
};
export type { CreateUserInput } from './user-repository.js';
export type { AddressRow, AddressWriteInput, AddressUpdateInput } from './address-repository.js';
export type {
  CustomerBookingRow,
  TechnicianBookingRow,
  BookingStatusEventRow,
  CreateBookingData,
  CreateBookingResult,
  CancelBookingResult,
} from './booking-repository.js';
export type {
  PublicSlotRow,
  TechnicianSlotRow,
  SlotWriteInput,
  SlotWriteResult,
} from './availability-repository.js';
export type {
  CatalogueCategoryRow,
  CatalogueServiceRow,
  CatalogueSortRow,
  SearchActiveServicesParams,
  ServicePriceRow,
} from './catalog-repository.js';
