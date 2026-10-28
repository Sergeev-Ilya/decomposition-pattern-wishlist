/** Browser DTOs from docs/api-gateway.yaml. Prices are integer kopecks, not rubles. */
export type UUID = string;
export type DateTime = string;
/** 32 random bytes, base64url without padding (43 characters). Never persist reservation tokens. */
export type CapabilityToken = string;
export type EmptyJson = Record<string, never>;

export interface ErrorResponse {
  error: { code: string; message: string };
  requestId: UUID;
}

export interface AuthCredentials { email: string; password: string }
export interface AuthUser { id: UUID; email: string; displayName: string; createdAt: DateTime }
export interface AuthUserResponse { user: AuthUser }

export interface WishlistInput { title: string; description?: string }
type AtLeastOne<T> = { [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>> }[keyof T];
export type WishlistPatch = AtLeastOne<WishlistInput>;
export interface GiftInput { title: string; priceKopecks: number; url?: string; note?: string }
export type GiftPatch = AtLeastOne<GiftInput>;

/** Owner projections deliberately contain no reservation information. */
export interface WishlistSummary {
  id: UUID;
  title: string;
  description: string;
  shareToken: CapabilityToken;
  giftCount: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}
export interface Gift {
  id: UUID;
  wishlistId: UUID;
  title: string;
  priceKopecks: number;
  currency: 'RUB';
  url: string;
  note: string;
  version: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}
export interface WishlistDetail extends WishlistSummary { gifts: Gift[] }
export interface WishlistsResponse { wishlists: WishlistSummary[] }
export interface WishlistResponse { wishlist: WishlistDetail }
export interface GiftResponse { gift: Gift }
export interface ShareLinkResponse { shareToken: CapabilityToken }

export interface PublicGift {
  id: UUID;
  title: string;
  priceKopecks: number;
  currency: 'RUB';
  url: string;
  note: string;
}
export interface SharedOwnerGift extends PublicGift { reserved?: never }
export interface SharedGuestGift extends PublicGift { reserved: boolean }
interface SharedWishlistFields { id: UUID; title: string; description: string }
export interface SharedOwnerWishlist extends SharedWishlistFields { isOwner: true; gifts: SharedOwnerGift[] }
export interface SharedGuestWishlist extends SharedWishlistFields { isOwner: false; gifts: SharedGuestGift[] }
export type SharedWishlist = SharedOwnerWishlist | SharedGuestWishlist;
export interface SharedWishlistResponse { wishlist: SharedWishlist }

/** Issued once; use only in request/route/component memory. */
export interface ReservationCreatedResponse { reservationToken: CapabilityToken }
export interface ReservationView {
  id: UUID;
  status: 'active' | 'canceled';
  createdAt: DateTime;
  canceledAt: DateTime | null;
  giftChanged: boolean;
  gift: Gift;
}
export interface ReservationResponse { reservation: ReservationView }
