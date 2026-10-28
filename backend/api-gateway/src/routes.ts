export type Identity = 'auth' | 'owner' | 'optional' | 'secret' | 'health';
export interface Route { pattern: RegExp; methods: string[]; identity: Identity; empty?: boolean; rate?: 'auth' | 'reserve' | 'secret'; }
export const routes: Route[] = [
  { pattern: /^\/health$/, methods: ['GET'], identity: 'health' },
  { pattern: /^\/api\/auth\/(register|login)$/, methods: ['POST'], identity: 'auth', rate: 'auth' },
  { pattern: /^\/api\/auth\/me$/, methods: ['GET'], identity: 'auth' },
  { pattern: /^\/api\/auth\/logout$/, methods: ['POST'], identity: 'auth', empty: true },
  { pattern: /^\/api\/wishlists$/, methods: ['GET', 'POST'], identity: 'owner' },
  { pattern: /^\/api\/wishlists\/[^/]+$/, methods: ['GET', 'PATCH', 'DELETE'], identity: 'owner' },
  { pattern: /^\/api\/wishlists\/[^/]+\/gifts$/, methods: ['POST'], identity: 'owner' },
  { pattern: /^\/api\/wishlists\/[^/]+\/gifts\/[^/]+$/, methods: ['PATCH', 'DELETE'], identity: 'owner' },
  { pattern: /^\/api\/wishlists\/[^/]+\/share-link$/, methods: ['POST'], identity: 'owner', empty: true },
  { pattern: /^\/api\/shared\/[^/]+$/, methods: ['GET'], identity: 'optional' },
  { pattern: /^\/api\/shared\/[^/]+\/gifts\/[^/]+\/reservations$/, methods: ['POST'], identity: 'optional', empty: true, rate: 'reserve' },
  { pattern: /^\/api\/reservations\/[^/]+$/, methods: ['GET'], identity: 'secret', rate: 'secret' },
  { pattern: /^\/api\/reservations\/[^/]+\/cancel$/, methods: ['POST'], identity: 'secret', empty: true, rate: 'secret' },
];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
