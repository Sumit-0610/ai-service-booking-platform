import { addressRepository } from './address-repository.js';
import { availabilityRepository } from './availability-repository.js';
import { bookingRepository } from './booking-repository.js';
import { catalogRepository } from './catalog-repository.js';
import { operationsRepository } from './operations-repository.js';
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
  operations: operationsRepository,
  technicians: technicianRepository,
  users: userRepository,
};

export {
  addressRepository,
  availabilityRepository,
  bookingRepository,
  catalogRepository,
  operationsRepository,
  technicianRepository,
  userRepository,
};
export type { CreateUserInput } from './user-repository.js';
export type { AddressRow, AddressWriteInput, AddressUpdateInput } from './address-repository.js';
export type {
  CustomerBookingRow,
  TechnicianBookingRow,
  TechnicianJobRow,
  BookingStatusEventRow,
  CreateBookingData,
  CreateBookingResult,
  CancelBookingResult,
  TechnicianJobStatusResult,
} from './booking-repository.js';
export type {
  OperationsBookingSummaryRow,
  OperationsBookingDetailRow,
  OperationsBookingSearchParams,
  OperationsDashboardCounts,
  OperationsStatusChangeResult,
  AssignTechnicianResult,
  AssignableTechnicianRow,
} from './operations-repository.js';
export type {
  OperationsTechnicianSummaryRow,
  OperationsTechnicianDetailRow,
  TechnicianSearchParams,
  AddQualificationResult,
} from './technician-repository.js';
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
