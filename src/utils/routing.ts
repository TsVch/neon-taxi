// ============================================================================
// Nominatim Geocoding + OSRM Routing
// ============================================================================

import type { GeocodedPlace, PlannedRoute } from "@/types/taximeter";
import { cumulativeDistances } from "./haversine";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

/**
 * Geocode an address query using Nominatim (OpenStreetMap).
 */
export async function geocodeAddress(
  query: string,
): Promise<GeocodedPlace | null> {
  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "Accept-Language": "ru,en",
        "User-Agent": "NeonTaxi/1.0",
      },
    });

    if (!response.ok) {
      console.warn("Nominatim error:", response.status);
      return null;
    }

    const data = await response.json();
    if (!data || data.length === 0) return null;

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

/**
 * Get a driving route between two points using OSRM.
 * OSRM returns GeoJSON [lon, lat] — we convert to [lat, lon].
 */
export async function getRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<PlannedRoute | null> {
  try {
    const url = `${OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;

    const response = await fetch(url);

    if (!response.ok) {
      console.warn("OSRM error:", response.status);
      return null;
    }

    const data = await response.json();

    if (!data || !data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    // OSRM returns [lon, lat] — convert to [lat, lon]
    const coords: Array<[number, number]> = route.geometry.coordinates.map(
      ([lon, lat]: [number, number]) => [lat, lon] as [number, number],
    );

    const cumulativeM = cumulativeDistances(coords);

    return {
      coords,
      cumulativeM,
      totalDistanceM: route.distance, // meters from OSRM
      totalDurationS: route.duration, // seconds from OSRM
    };
  } catch (error) {
    console.error("OSRM routing error:", error);
    return null;
  }
}
