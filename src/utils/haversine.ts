// ============================================================================
// Haversine Formula — расстояние между двумя GPS координатами
// ============================================================================

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate distance in meters between two GPS coordinates using the Haversine formula.
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculate total distance of a path of coordinates [lat, lon].
 */
export function pathDistanceMeters(coords: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(
      coords[i - 1][0],
      coords[i - 1][1],
      coords[i][0],
      coords[i][1],
    );
  }
  return total;
}

/**
 * Calculate cumulative distances from the start for each coordinate.
 * Returns an array where cumulatives[i] = distance from start to coords[i].
 */
export function cumulativeDistances(
  coords: Array<[number, number]>,
): number[] {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(
      coords[i - 1][0],
      coords[i - 1][1],
      coords[i][0],
      coords[i][1],
    );
    cum.push(total);
  }
  return cum;
}
