// ============================================================================
// Nominatim Geocoding + OSRM Routing
// ============================================================================

import type { GeocodedPlace, PlannedRoute } from "@/types/taximeter";
import { cumulativeDistances } from "./haversine";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

// Москва и ближайшее Подмосковье
const MOSCOW_VIEWBOX = "37.0,55.3,38.2,56.2";

/**
 * Базовый геокодинг-запрос к Nominatim.
 */
async function nominatimSearch(params: {
  query: string;
  limit: number;
  restricted: boolean;
}): Promise<GeocodedPlace[]> {
  const { query, limit, restricted } = params;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "ru");

  if (restricted) {
    url.searchParams.set("viewbox", MOSCOW_VIEWBOX);
    url.searchParams.set("bounded", "1");
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Accept-Language": "ru,en",
      "User-Agent": "NeonTaxi/1.0",
    },
  });

  if (!response.ok) return [];

  const data = await response.json();
  if (!data || !Array.isArray(data)) return [];

  return data.map(
    (item: { lat: string; lon: string; display_name: string }): GeocodedPlace => ({
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      displayName: item.display_name,
    }),
  );
}

/**
 * Подсказки адресов для автодополнения (autocomplete).
 * Сначала ищет в Москве и области, при пустом результате — по всей России.
 */
export async function searchAddresses(
  query: string,
): Promise<GeocodedPlace[]> {
  if (!query || query.trim().length < 2) return [];

  try {
    // Pass 1: Moscow area only
    let results = await nominatimSearch({
      query: query.trim(),
      limit: 5,
      restricted: true,
    });

    // Pass 2: если Москва ничего не дала — ищем по всей России
    if (results.length === 0) {
      results = await nominatimSearch({
        query: query.trim(),
        limit: 5,
        restricted: false,
      });
    }

    return results;
  } catch (error) {
    console.error("Autocomplete error:", error);
    return [];
  }
}

/**
 * Геокодирование одного адреса через Nominatim (для финального подтверждения).
 * Сначала ищет в Москве и области, при пустом результате — по всей России.
 */
export async function geocodeAddress(
  query: string,
): Promise<GeocodedPlace | null> {
  try {
    // Pass 1: Moscow area only
    let results = await nominatimSearch({
      query: query.trim(),
      limit: 1,
      restricted: true,
    });

    // Pass 2: если Москва ничего не дала — ищем по всей России
    if (results.length === 0) {
      results = await nominatimSearch({
        query: query.trim(),
        limit: 1,
        restricted: false,
      });
    }

    return results.length > 0 ? results[0] : null;
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
