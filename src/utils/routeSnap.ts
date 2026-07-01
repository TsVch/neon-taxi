// ============================================================================
// Route Snapping — привязка GPS к маршруту с монотонным курсором
// ============================================================================

import { haversineMeters } from "./haversine";
import type { PlannedRoute, SnapResult } from "@/types/taximeter";
import { GPS_CONSTANTS } from "@/types/taximeter";

/**
 * Project a point onto a line segment defined by two points.
 * Returns the projection fraction (0-1), the projected point, and distance.
 */
function projectPointToSegment(
  lat: number,
  lon: number,
  segLat1: number,
  segLon1: number,
  segLat2: number,
  segLon2: number,
): { fraction: number; projLat: number; projLon: number; distance: number } {
  const dx = segLon2 - segLon1;
  const dy = segLat2 - segLat1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const d = haversineMeters(lat, lon, segLat1, segLon1);
    return { fraction: 0, projLat: segLat1, projLon: segLon1, distance: d };
  }

  const t =
    ((lon - segLon1) * dx + (lat - segLat1) * dy) / lengthSq;
  const clampedT = Math.max(0, Math.min(1, t));

  const projLat = segLat1 + clampedT * dy;
  const projLon = segLon1 + clampedT * dx;
  const distance = haversineMeters(lat, lon, projLat, projLon);

  return { fraction: clampedT, projLat, projLon, distance };
}

/**
 * Binary search to find the range of indices in cumulativeM that fall within [startM, endM].
 */
function binarySearchRange(
  cumulativeM: number[],
  startM: number,
  endM: number,
): [number, number] {
  let left = 0;
  let right = cumulativeM.length - 1;

  // Find left bound
  while (left < right) {
    const mid = (left + right) >> 1;
    if (cumulativeM[mid] < startM) left = mid + 1;
    else right = mid;
  }
  const startIdx = Math.max(0, left - 1);

  // Find right bound
  left = 0;
  right = cumulativeM.length - 1;
  while (left < right) {
    const mid = (left + right + 1) >> 1;
    if (cumulativeM[mid] > endM) right = mid - 1;
    else left = mid;
  }
  const endIdx = Math.min(cumulativeM.length - 1, left + 1);

  return [startIdx, endIdx];
}

/**
 * Snap a GPS point to the planned route with monotonic cursor.
 *
 * The cursor only moves forward — it never goes backward.
 * This prevents the car from "jumping" back on the route.
 *
 * @param lat GPS latitude
 * @param lon GPS longitude
 * @param route The planned route
 * @param currentCursorM Current distance from route start (meters)
 * @param maxAdvanceM Maximum advance per update (rate limit)
 * @param searchBehindM How far behind the cursor to search
 * @returns SnapResult with snapped position and new cursor
 */
export function snapToRoute(
  lat: number,
  lon: number,
  route: PlannedRoute,
  currentCursorM: number,
  maxAdvanceM: number = Infinity,
  searchBehindM: number = GPS_CONSTANTS.SEARCH_BEHIND_M,
): SnapResult {
  const { coords, cumulativeM } = route;

  if (coords.length < 2) {
    return {
      snappedLat: lat,
      snappedLon: lon,
      cursorM: currentCursorM,
      segmentIndex: 0,
      deviation: 0,
    };
  }

  // Define search window: [cursor - behind, cursor + maxAdvance]
  const searchStart = Math.max(0, currentCursorM - searchBehindM);
  const searchEnd = currentCursorM + maxAdvanceM;

  // Binary search for the range of segments to check
  const [startIdx, endIdx] = binarySearchRange(
    cumulativeM,
    searchStart,
    searchEnd,
  );

  // Find the closest projection within the search window
  let bestDistance = Infinity;
  let bestProjLat = lat;
  let bestProjLon = lon;
  let bestFraction = 0;
  let bestSegIdx = startIdx;
  let bestSegDistFromStart = currentCursorM;

  for (let i = startIdx; i < endIdx && i < coords.length - 1; i++) {
    const result = projectPointToSegment(
      lat,
      lon,
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1],
    );

    // Calculate distance from route start for this projection
    const segStartDist = cumulativeM[i];
    const segEndDist = cumulativeM[i + 1];
    const projDistFromStart = segStartDist + result.fraction * (segEndDist - segStartDist);

    if (result.distance < bestDistance) {
      bestDistance = result.distance;
      bestProjLat = result.projLat;
      bestProjLon = result.projLon;
      bestFraction = result.fraction;
      bestSegIdx = i;
      bestSegDistFromStart = projDistFromStart;
    }
  }

  // CRITICAL: cursor is monotonic — never moves backward
  const newCursorM = Math.max(currentCursorM, bestSegDistFromStart);

  return {
    snappedLat: bestProjLat,
    snappedLon: bestProjLon,
    cursorM: newCursorM,
    segmentIndex: bestSegIdx,
    deviation: bestDistance,
  };
}

/**
 * Check if the route needs to be recalculated (deviation > threshold for too long).
 */
export function shouldRecalculateRoute(
  deviation: number,
  deviationDurationMs: number,
): boolean {
  return (
    deviation > GPS_CONSTANTS.ROUTE_DEVIATION_THRESHOLD_M &&
    deviationDurationMs > GPS_CONSTANTS.ROUTE_DEVIATION_TIMEOUT_MS
  );
}
