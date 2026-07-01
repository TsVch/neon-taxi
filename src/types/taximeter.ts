// ============================================================================
// GPS Quality Types
// ============================================================================

export type GpsQuality =
  | "good" // accuracy ≤ 50м
  | "degraded" // accuracy 50-200м
  | "poor" // accuracy 200-500м
  | "dead_reck" // нет GPS обновления, dead reckoning
  | "sim"; // симулятор

export type TripStatus = "idle" | "ready" | "in_progress" | "completed";

export type EventType = "info" | "warn" | "gps" | "error" | "system" | "dr";

// ============================================================================
// GPS & Location Types
// ============================================================================

export interface GpsPoint {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number | null; // m/s from Doppler
  heading: number | null;
  timestamp: number;
  quality: GpsQuality;
}

export interface SmoothGpsState {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number; // m/s
  heading: number | null;
  timestamp: number;
  quality: GpsQuality;
}

export interface DeadReckoningState {
  active: boolean;
  elapsedSinceLastGPS: number; // seconds
  lastSpeed: number; // m/s
  decayFactor: number;
  estimatedLat: number;
  estimatedLon: number;
  heading: number | null;
}

// ============================================================================
// Route Types
// ============================================================================

export interface GeocodedPlace {
  lat: number;
  lon: number;
  displayName: string;
}

export interface PlannedRoute {
  coords: Array<[number, number]>; // [lat, lon]
  cumulativeM: number[];
  totalDistanceM: number;
  totalDurationS: number;
}

export interface SnapResult {
  snappedLat: number;
  snappedLon: number;
  cursorM: number;
  segmentIndex: number;
  deviation: number; // meters from route
}

// ============================================================================
// Tariff Types
// ============================================================================

export type TariffId =
  | "economy"
  | "comfort"
  | "comfort_plus"
  | "business"
  | "minivan_premium";

export interface TariffConfig {
  id: TariffId;
  name: string;
  S: number; // base fare (₽)
  rd: number; // per km rate (₽/km)
  rt: number; // per minute rate (₽/min)
}

export const TARIFFS: Record<TariffId, TariffConfig> = {
  economy: { id: "economy", name: "Economy", S: 80, rd: 30, rt: 10 },
  comfort: { id: "comfort", name: "Comfort", S: 120, rd: 40, rt: 10 },
  comfort_plus: { id: "comfort_plus", name: "Comfort+", S: 160, rd: 50, rt: 15 },
  business: { id: "business", name: "Business", S: 200, rd: 80, rt: 15 },
  minivan_premium: { id: "minivan_premium", name: "Minivan Premium", S: 300, rd: 100, rt: 20 },
};

export interface KtodCoefficients {
  weekdayDay: number;   // Пн-Пт 06:00-22:00
  weekdayNight: number;  // Пн-Пт 22:00-06:00
  weekendDay: number;    // Сб-Вс 09:00-22:00
  weekendNight: number;  // Сб-Вс 22:00-09:00
}

export const DEFAULT_KTOD: KtodCoefficients = {
  weekdayDay: 1.0,
  weekdayNight: 1.5,
  weekendDay: 1.5,
  weekendNight: 2.0,
};

// ============================================================================
// Trip & Event Types
// ============================================================================

export interface TripData {
  id: string;
  startTime: number;
  endTime: number | null;
  distanceM: number;
  totalCost: number;
  tariffId: TariffId;
  tariff: TariffConfig;
  ktod: number;
  ktodCoeffs: KtodCoefficients;
  fromAddress: string;
  toAddress: string;
  fromCoords: [number, number] | null;
  toCoords: [number, number] | null;
  route: PlannedRoute | null;
  status: TripStatus;
}

export interface LogEvent {
  id: string;
  timestamp: number;
  type: EventType;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// IMU Types
// ============================================================================

export interface IMUSnapshot {
  heading: number | null;
  isMoving: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const GPS_CONSTANTS = {
  GOOD_THRESHOLD: 50,
  DEGRADED_THRESHOLD: 200,
  POOR_THRESHOLD: 500,
  MAX_SPEED_M_S: 55, // ~200 km/h
  MIN_MOVEMENT_M: 4,
  DR_TIMEOUT_MS: 4000,
  DR_DECAY_FACTOR: 0.5,
  EMA_ALPHA: 0.7,
  ROUTE_DEVIATION_THRESHOLD_M: 250,
  ROUTE_DEVIATION_TIMEOUT_MS: 45000,
  ARRIVAL_THRESHOLD: 0.98, // 98%
  REMINDER_INTERVAL_MS: 300000, // 5 min
  SIM_INTERVAL_MS: 1500,
  SEARCH_BEHIND_M: 200,
} as const;

// ============================================================================
// Simulation Route (Москва)
// ============================================================================

export const SIMULATION_ROUTE: Array<[number, number]> = [
  [55.7558, 37.6173],
  [55.757, 37.619],
  [55.7585, 37.622],
  [55.7602, 37.6255],
  [55.762, 37.629],
  [55.764, 37.633],
  [55.766, 37.637],
  [55.768, 37.641],
  [55.7705, 37.645],
  [55.773, 37.649],
  [55.7755, 37.653],
  [55.778, 37.657],
  [55.7805, 37.661],
  [55.783, 37.665],
  [55.7855, 37.669],
  [55.788, 37.673],
  [55.79, 37.677],
  [55.792, 37.681],
  [55.794, 37.685],
  [55.796, 37.689],
  [55.798, 37.693],
  [55.8, 37.697],
  [55.8015, 37.701],
  [55.803, 37.705],
  [55.8045, 37.709],
  [55.806, 37.713],
  [55.8075, 37.717],
  [55.809, 37.721],
  [55.8105, 37.725],
  [55.812, 37.729],
];
