// FE-011: compile-time contract between hand-written FE types and the generated OpenAPI types (api-types.gen.ts).
// Each line asserts that a response as documented by the backend is assignable to the type the FE reads, so a
// renamed, removed or retyped field fails `tsc`/`next build`. Regenerate with `npm run types:generate`.
import type { components } from './api-types.gen';
import type { LedgerEntry } from './cash-account';
import type { CalendarBooking, CalendarHold } from './reception-calendar';
import type { MyTenant } from './session';
import type { PublicHoldReceipt } from './public-booking';
import type { Availability, Branch as PublicBranch, Lookup, Quote, Room as PublicRoom, Terms } from '../components/customer-booking';
import type { Account } from '../components/booking-account';
import type { Report, Unresolved, UnresolvedPage } from '../components/cash-reconciliation';
import type { DepositEntry, DepositSnapshot, DepositStatus, DetailedHold } from '../components/hold-details';
import type { Booking, Page as BookingPage } from '../components/booking-operations';
import type { Page as UserPage, PlatformUser } from '../components/platform-users';
import type { Branch as PlatformBranch, Member } from '../components/platform-members';
import type { Created, Merchant, Page as MerchantPage } from '../components/platform-merchants';
import type { Listing, ListingDocument, Page as ListingPage } from '../components/platform-listings';
import type { MerchantDocument } from '../components/merchant-documents';
import type { MerchantLogo } from '../components/merchant-logo';
import type { Media } from '../components/room-media';
import type { Membership } from '../components/memberships';
import type { AuditEntry } from '../components/audit-log';
import type { AuthSession } from '../components/my-sessions';
import type { HoldBacklog, OutboxBacklog } from '../components/ops-backlog';
import type { OvertimePolicy } from '../components/overtime-settings';
import type { Publication } from '../components/catalog-publication';
import type { Branch as MerchantBranch, Me, Room as MerchantRoom } from '../components/experience';

type S = components['schemas'];
/** True when the documented response (Api) can be used where the FE type (Fe) is expected. */
type Fits<Api, Fe> = [Api] extends [Fe] ? true : false;
type Expect<T extends true> = T;

export type ContractChecks = [
  Expect<Fits<S['PublicBranchDto'], PublicBranch>>,
  Expect<Fits<S['PublicRoomDto'], PublicRoom>>,
  Expect<Fits<S['PublicAvailabilityResponseDto'], Availability>>,
  Expect<Fits<S['PublicQuoteResponseDto'], Quote>>,
  Expect<Fits<S['PublicBookingTermsResponseDto'], Terms>>,
  Expect<Fits<S['PublicBookingStatusDto'], Lookup>>,
  Expect<Fits<S['PublicHoldResponseDto'], Omit<PublicHoldReceipt, 'phone'>>>,
  Expect<Fits<S['BookingAccountDto'], Account>>,
  Expect<Fits<S['LedgerEntryDto'], LedgerEntry>>,
  Expect<Fits<S['CashReportDto'], Report>>,
  Expect<Fits<S['UnresolvedDepositDto'], Unresolved>>,
  Expect<Fits<S['UnresolvedDepositListDto'], UnresolvedPage>>,
  Expect<Fits<S['HoldResponseDto'], DetailedHold>>,
  Expect<Fits<S['HoldResponseDto'], CalendarHold>>,
  Expect<Fits<S['HoldDepositStatusDto'], DepositStatus>>,
  Expect<Fits<S['HoldDepositEntryDto'], DepositEntry>>,
  Expect<Fits<S['DepositPolicySnapshotDto'], DepositSnapshot>>,
  Expect<Fits<S['BookingResponseDto'], Booking>>,
  Expect<Fits<S['BookingResponseDto'], CalendarBooking>>,
  Expect<Fits<S['BookingListResponseDto'], BookingPage>>,
  Expect<Fits<S['PlatformUserDto'], PlatformUser>>,
  Expect<Fits<S['PlatformUserListDto'], UserPage>>,
  Expect<Fits<S['MembershipResponseDto'], Member>>,
  Expect<Fits<S['MembershipResponseDto'], Membership>>,
  Expect<Fits<S['PlatformBranchDto'], PlatformBranch>>,
  Expect<Fits<S['MerchantSummaryDto'], Merchant>>,
  Expect<Fits<S['CreatedMerchantDto'], Created>>,
  Expect<Fits<S['MerchantListDto'], MerchantPage>>,
  Expect<Fits<S['ListingResponseDto'], Listing>>,
  Expect<Fits<S['ListingListDto'], ListingPage>>,
  Expect<Fits<S['MerchantDocumentDto'], ListingDocument>>,
  Expect<Fits<S['MerchantDocumentDto'], MerchantDocument>>,
  Expect<Fits<S['MerchantLogoDto'], MerchantLogo>>,
  Expect<Fits<S['RoomMediaResponseDto'], Media>>,
  Expect<Fits<S['AuditLogResponseDto'], AuditEntry>>,
  Expect<Fits<S['SessionResponseDto'], AuthSession>>,
  Expect<Fits<S['HoldExpiryBacklogDto'], HoldBacklog>>,
  Expect<Fits<S['OutboxBacklogDto'], OutboxBacklog>>,
  Expect<Fits<S['OvertimePolicyDto'], OvertimePolicy>>,
  Expect<Fits<S['PublicationResponseDto'], Publication>>,
  Expect<Fits<S['MyTenantDto'], MyTenant>>,
  Expect<Fits<S['MerchantMeDto'], Me>>,
  Expect<Fits<S['BranchResponseDto'], MerchantBranch>>,
  Expect<Fits<S['RoomResponseDto'], MerchantRoom>>,
];
