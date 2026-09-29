import { describe, expect, it } from 'vitest';
import { overpassQuery, parseOverpass, roundPosition } from './stations';

const HERE = { latitude: 36.8442, longitude: 10.2425 };

describe('roundPosition', () => {
  it('keeps about 11 m of precision before anything is sent', () => {
    expect(roundPosition({ latitude: 36.844_217_3, longitude: 10.242_561_9 })).toEqual({
      latitude: 36.8442,
      longitude: 10.2426,
    });
  });
});

describe('overpassQuery', () => {
  it('asks for fuel stations of any geometry around the point', () => {
    const query = overpassQuery(HERE, 300);
    expect(query).toContain('nwr["amenity"="fuel"](around:300,36.8442,10.2425)');
    expect(query).toContain('out center');
  });
});

describe('parseOverpass', () => {
  it('names stations by sign, then brand, nearest first, one per name', () => {
    const stations = parseOverpass(
      {
        elements: [
          { lat: 36.8452, lon: 10.2425, tags: { amenity: 'fuel', brand: 'Agil' } },
          { center: { lat: 36.8443, lon: 10.2425 }, tags: { amenity: 'fuel', name: 'Shell Lac 2' } },
          { lat: 36.8444, lon: 10.2425, tags: { amenity: 'fuel', name: 'shell lac 2' } },
          { lat: 36.8445, lon: 10.2425, tags: { amenity: 'fuel' } }, // unnamed
          { tags: { name: 'No position' } },
        ],
      },
      HERE,
    );

    expect(stations.map((s) => [s.name, s.source])).toEqual([
      ['Shell Lac 2', 'osm'],
      ['Agil', 'osm'],
    ]);
    expect(stations[0].distanceMeters).toBe(11);
  });

  it('survives an answer with nothing in it', () => {
    expect(parseOverpass(null, HERE)).toEqual([]);
    expect(parseOverpass({}, HERE)).toEqual([]);
  });
});
