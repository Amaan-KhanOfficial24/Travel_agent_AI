// When a fare disappears, which new offer is "the same trip"? Deterministic rules, never
// the AI's judgement, because the answer decides what the customer is charged for.
import { toMinor } from '../money.js';
import type { FlightOffer } from '../providers/duffel/normalize.js';

export type MatchTier = 'EXACT' | 'SAME_FLIGHTS_NEW_FARE' | 'EQUIVALENT';

const WINDOW_MINUTES = 180; // an alternative must leave within 3 hours of the original

const minutes = (localIso: string) => Date.parse(localIso.slice(0, 16) + ':00Z') / 60_000;

function isEquivalent(original: FlightOffer, candidate: FlightOffer): boolean {
  if (candidate.cabin !== original.cabin) return false;
  if (candidate.slices.length !== original.slices.length) return false;
  if (candidate.baggage.checked < original.baggage.checked) return false; // never silently drop bags
  return original.slices.every((s, i) => {
    const c = candidate.slices[i]!;
    return (
      c.origin === s.origin &&
      c.destination === s.destination &&
      c.departingAt.slice(0, 10) === s.departingAt.slice(0, 10) &&
      Math.abs(minutes(c.departingAt) - minutes(s.departingAt)) <= WINDOW_MINUTES &&
      c.stops <= s.stops
    );
  });
}

/** Tier a single candidate against the original offer, or null if it is not acceptable. */
export function matchTier<T extends FlightOffer>(original: FlightOffer, candidate: T): MatchTier | null {
  if (candidate.itineraryKey === original.itineraryKey && candidate.cabin === original.cabin) {
    return (candidate.fareBrand ?? '') === (original.fareBrand ?? '') ? 'EXACT' : 'SAME_FLIGHTS_NEW_FARE';
  }
  return isEquivalent(original, candidate) ? 'EQUIVALENT' : null;
}

const TIER_RANK: Record<MatchTier, number> = { EXACT: 0, SAME_FLIGHTS_NEW_FARE: 1, EQUIVALENT: 2 };

/** Acceptable replacements, best first: exact flights before equivalents, then cheapest. */
export function findAlternatives<T extends FlightOffer>(original: FlightOffer, candidates: T[]): { offer: T; tier: MatchTier }[] {
  return candidates
    .filter((c) => c.providerOfferId !== original.providerOfferId)
    .map((offer) => ({ offer, tier: matchTier(original, offer) }))
    .filter((m): m is { offer: T; tier: MatchTier } => m.tier !== null)
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || toMinor(a.offer.totalAmount) - toMinor(b.offer.totalAmount));
}
