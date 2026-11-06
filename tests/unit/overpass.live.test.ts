import { describe, expect, it } from 'vitest';
import { ENDPOINTS, searchFireStations } from '../../src/osm/overpass';

// Prawdziwa sieć: uruchamiane tylko na żądanie, LIVE_OVERPASS=1 npx vitest run overpass.live
describe.skipIf(!process.env.LIVE_OVERPASS)('prawdziwe Overpass', () => {
  it('zwraca remizy z okolic Krakowa', async () => {
    const r = await searchFireStations({ lat: 50.0614, lng: 19.9366 }, 10, { online: true });
    console.log(`${r.endpoint}: ${r.candidates.length} wyników; np. ${r.candidates.slice(0, 3).map((c) => `${c.ref} ${c.name}`).join(' | ')}`);
    expect(ENDPOINTS).toContain(r.endpoint);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.osm.tags.amenity === 'fire_station')).toBe(true);
  }, 120_000);
});
