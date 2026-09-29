'use client';

import { useEffect, useState } from 'react';
import { fuelApi } from '@/lib/fuel/fuel-api';
import {
  type Position,
  type StationCandidate,
  currentPosition,
  osmStationsNear,
  roundPosition,
} from '@/lib/fuel/stations';

export type FinderStatus = 'locating' | 'searching' | 'found' | 'none-nearby' | 'unavailable';

export interface StationFinder {
  status: FinderStatus;
  /** Rounded to ~11 m; saved with the entry so the next visit is matched from history. */
  position: Position | null;
  candidates: StationCandidate[];
}

/**
 * Works out where the fill-up is happening, once, when the form opens.
 *
 * History before OpenStreetMap: a station this car has used before is the
 * likeliest answer, and matching it needs nothing outside CarCare. OSM is
 * asked only when history has nothing within 300 m.
 */
export function useStationFinder(vehicleId: string, enabled: boolean): StationFinder {
  const [state, setState] = useState<StationFinder>({
    status: enabled ? 'locating' : 'unavailable',
    position: null,
    candidates: [],
  });

  useEffect(() => {
    if (!enabled) return;

    const abort = new AbortController();
    let cancelled = false;
    const update = (next: StationFinder) => {
      if (!cancelled) setState(next);
    };

    void (async () => {
      const fix = await currentPosition();
      if (!fix) return update({ status: 'unavailable', position: null, candidates: [] });

      const position = roundPosition(fix);
      update({ status: 'searching', position, candidates: [] });

      try {
        const known = await fuelApi.suggestions(vehicleId, position);
        if (known.nearbyStations.length > 0) {
          return update({
            status: 'found',
            position,
            candidates: known.nearbyStations.map((s) => ({ ...s, source: 'history' as const })),
          });
        }
      } catch {
        // History is a nicety; OSM can still answer.
      }

      try {
        const osm = await osmStationsNear(position, abort.signal);
        update({ status: osm.length > 0 ? 'found' : 'none-nearby', position, candidates: osm.slice(0, 4) });
      } catch {
        // Offline, rate-limited or blocked: the location is still worth keeping.
        update({ status: 'none-nearby', position, candidates: [] });
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [vehicleId, enabled]);

  return state;
}
