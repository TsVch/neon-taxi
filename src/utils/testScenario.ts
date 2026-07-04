// ============================================================================
// Test Scenario — 10 км имитация поездки, ~10 мин, 60 км/ч
// ============================================================================
//
// Маршрут: Москва (Кремль → Кутузовский пр-т → Поклонная гора)
// Длина: ~10 км, время: ~10 мин при средней скорости ~60 км/ч
//
// Этапы:
//   0–2  км — нормальная поездка
//   2–3  км — ⛔ ПРОПАЖА GPS  → Dead Reckoning + IMU
//   3–5  км — норм. GPS
//   5–6.5 км — 🚗 ОТКЛОНЕНИЕ от маршрута → snap-to-route, рост deviation
//   6.5–7.5 — возврат на маршрут
//   7.5–7.7 км — ✋ ОСТАНОВКА (светофор ~12 с)
//   7.7–10 км — финиш
// ============================================================================

import { haversineMeters } from "./haversine";
import type { PlannedRoute } from "@/types/taximeter";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export type ScenarioEventType =
  | "gps_loss"
  | "gps_restore"
  | "route_deviation"
  | "route_return"
  | "traffic_stop";

export interface ScenarioEvent {
  type: ScenarioEventType;
  triggerKm: number;
  durationKm?: number;
  params?: Record<string, number>;
}

export interface ScenarioDef {
  name: string;
  description: string;
  route: Array<[number, number]>;
  deviationRoute?: Array<[number, number]>;
  events: ScenarioEvent[];
  defaultSpeedKmh: number;
  fromLabel: string;
  toLabel: string;
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function lerp(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Уплотнение точек (каждые ~100м) */
function densifyRoute(
  waypoints: Array<[number, number]>,
  maxStepM = 100,
): Array<[number, number]> {
  if (waypoints.length < 2) return waypoints;
  const result: Array<[number, number]> = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const segDist = haversineMeters(from[0], from[1], to[0], to[1]);
    if (segDist <= maxStepM) {
      result.push(to);
    } else {
      const steps = Math.ceil(segDist / maxStepM);
      for (let s = 1; s <= steps; s++) {
        result.push(lerp(from, to, s / steps));
      }
    }
  }
  return result;
}

function cumulativeMeters(
  coords: Array<[number, number]>,
): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]),
    );
  }
  return cum;
}

/**
 * Преобразует маршрут сценария в PlannedRoute для отображения на карте.
 */
export function scenarioToPlannedRoute(
  coords: Array<[number, number]>,
): PlannedRoute {
  const cumulativeM = cumulativeMeters(coords);
  const totalDistanceM = cumulativeM[cumulativeM.length - 1] || 0;
  // ~60 км/ч = 16.67 м/с
  const avgSpeedMs = 16.67;
  return {
    coords,
    cumulativeM,
    totalDistanceM,
    totalDurationS: Math.round(totalDistanceM / avgSpeedMs),
  };
}

// ---------------------------------------------------------------------------
// Точки маршрута (~10 км): Кремль → Кутузовский пр-т → Поклонная гора
// ---------------------------------------------------------------------------

const MAIN_WAYPOINTS: Array<[number, number]> = [
  // 0.0–0.8 км: Кремль → Боровицкая пл.
  [55.7537, 37.6208],  // Красная площадь (старт)
  [55.7525, 37.6170],  // Собор Василия Блаженного
  [55.7512, 37.6130],  // Боровицкая площадь

  // 0.8–2.0 км: Воздвиженка → Новый Арбат
  [55.7505, 37.6070],  // ул. Воздвиженка
  [55.7495, 37.6000],  // Новый Арбат, начало
  [55.7485, 37.5920],  // Новый Арбат, д. 21
  [55.7475, 37.5840],  // Новый Арбат, д. 15
  [55.7465, 37.5760],  // Новый Арбат, д. 11

  // 2.0–4.5 км: Кутузовский пр-т (начало)
  [55.7455, 37.5680],  // Кутузовский пр-т, начало
  [55.7445, 37.5600],  // Кутузовский пр-т, д. 7
  [55.7432, 37.5500],  // Украинский бульвар
  [55.7420, 37.5400],  // Кутузовский пр-т, д. 18
  [55.7410, 37.5300],  // Кутузовский пр-т, д. 24
  [55.7400, 37.5200],  // Кутузовский пр-т, д. 30
  [55.7390, 37.5100],  // Триумфальная арка

  // 4.5–7.0 км: Кутузовский пр-т (середина)
  [55.7380, 37.5000],  // Кутузовский пр-т, д. 36
  [55.7370, 37.4900],  // Парк Победы (начало)
  [55.7360, 37.4820],  // Кутузовский пр-т, д. 43
  [55.7350, 37.4740],  // Минская ул.
  [55.7340, 37.4660],  // Кутузовский пр-т, д. 48

  // 7.0–10.0 км: Поклонная гора
  [55.7330, 37.4580],  // Славянский бульвар
  [55.7320, 37.4500],  // Кутузовский пр-т, д. 55
  [55.7310, 37.4420],  // Поклонная ул.
  [55.7302, 37.4340],  // ул. Генерала Ермолова
  [55.7295, 37.4260],  // Можайский вал
  [55.7290, 37.4180],  // Кутузовский пр-т, конец
  [55.7285, 37.4100],  // Рябиновая ул.
  [55.7280, 37.4020],  // Бизнес-парк

  // 10 км — финиш
  [55.7275, 37.3940],  // Поклонная гора (финиш)
  [55.7272, 37.3900],
];

// Ответвление: съезд с Кутузовского на Минскую ул., затем возврат
const DEVIATION_WAYPOINTS: Array<[number, number]> = [
  [55.7350, 37.4740],  // Точка съезда (Кутузовский / Минская)
  [55.7330, 37.4730],  // Съезд на Минскую ул.
  [55.7315, 37.4720],  // Уход в сторону (отклонение ~200м)
  [55.7300, 37.4710],  // Параллельная улица
  [55.7285, 37.4700],  // Максимальное отклонение ~350м
  [55.7290, 37.4680],  // Начало возврата
  [55.7310, 37.4670],  // Возврат ближе к маршруту
  [55.7330, 37.4660],  // Выезд обратно на Кутузовский
];

// ---------------------------------------------------------------------------
// Сценарий 10 км
// ---------------------------------------------------------------------------

export const TEST_SCENARIO: ScenarioDef = {
  name: "Кремль → Поклонная гора, 10 км",
  description:
    "~10 мин, все кейсы: " +
    "норм.GPS → ⛔пропажа GPS(DR) → " +
    "норм.GPS → 🚗отклонение от маршрута → " +
    "✋остановка → финиш",
  route: densifyRoute(MAIN_WAYPOINTS, 80),
  deviationRoute: densifyRoute(DEVIATION_WAYPOINTS, 50),
  defaultSpeedKmh: 60,
  fromLabel: "Красная площадь",
  toLabel: "Поклонная гора",
  events: [
    // ЭТАП 1 (0–2 км): нормальная поездка
    // ЭТАП 2 (2–3 км): пропажа GPS
    { type: "gps_loss", triggerKm: 2.0, durationKm: 1.0, params: { accuracy: 999 } },
    { type: "gps_restore", triggerKm: 3.0, params: { accuracy: 15 } },
    // ЭТАП 3 (3–5 км): норма
    // ЭТАП 4 (5–6.5 км): отклонение
    { type: "route_deviation", triggerKm: 5.0, durationKm: 1.5 },
    { type: "route_return", triggerKm: 6.5 },
    // ЭТАП 5 (7.5–7.7 км): остановка
    { type: "traffic_stop", triggerKm: 7.5, durationKm: 0.2 },
    // ЭТАП 6 (7.7–10 км): финиш
  ],
};

// ---------------------------------------------------------------------------
// ScenarioRunner
// ---------------------------------------------------------------------------

export interface RunnerState {
  routeIndex: number;
  currentPoint: [number, number];
  currentSpeedMs: number;
  currentAccuracy: number;
  isDeviated: boolean;
  deviationIndex: number;
  distanceM: number;
  progress: number;
  isStopped: boolean;
  eventFlags: {
    gpsLost: boolean;
    gpsRestored: boolean;
    deviationStarted: boolean;
    deviationEnded: boolean;
    stopStarted: boolean;
    stopEnded: boolean;
  };
}

export class ScenarioRunner {
  private scenario: ScenarioDef;
  private cumulative: number[];
  private totalDistM: number;
  private state: RunnerState;

  constructor(scenario: ScenarioDef = TEST_SCENARIO) {
    this.scenario = scenario;
    this.cumulative = cumulativeMeters(scenario.route);
    this.totalDistM = this.cumulative[this.cumulative.length - 1] || 1;
    this.state = this.initialState();
  }

  get startPoint(): [number, number] | null {
    const r = this.scenario.route;
    return r.length > 0 ? r[0] : null;
  }

  get endPoint(): [number, number] | null {
    const r = this.scenario.route;
    return r.length > 0 ? r[r.length - 1] : null;
  }

  get plannedRoute(): PlannedRoute {
    return scenarioToPlannedRoute(this.scenario.route);
  }

  get deviationRoute(): Array<[number, number]> | undefined {
    return this.scenario.deviationRoute;
  }

  private initialState(): RunnerState {
    const route = this.scenario.route;
    return {
      routeIndex: 0,
      currentPoint: route.length > 0 ? [...route[0]] as [number, number] : [55.7558, 37.6173],
      currentSpeedMs: (this.scenario.defaultSpeedKmh * 1000) / 3600,
      currentAccuracy: 10,
      isDeviated: false,
      deviationIndex: 0,
      distanceM: 0,
      progress: 0,
      isStopped: false,
      eventFlags: {
        gpsLost: false,
        gpsRestored: false,
        deviationStarted: false,
        deviationEnded: false,
        stopStarted: false,
        stopEnded: false,
      },
    };
  }

  reset(): void {
    this.state = this.initialState();
  }

  getState(): RunnerState {
    return { ...this.state, currentPoint: [...this.state.currentPoint] };
  }

  advance(distDeltaM: number): void {
    const s = this.state;
    if (s.routeIndex >= this.scenario.route.length - 1) return;

    s.eventFlags = {
      gpsLost: false, gpsRestored: false,
      deviationStarted: false, deviationEnded: false,
      stopStarted: false, stopEnded: false,
    };

    s.distanceM += distDeltaM;
    const km = s.distanceM / 1000;
    s.progress = Math.min(1, s.distanceM / this.totalDistM);

    this.processEvents(km);

    if (s.isStopped) {
      s.currentSpeedMs = 0;
      return;
    }

    if (s.isDeviated && this.scenario.deviationRoute) {
      this.advanceOnDeviation(distDeltaM);
      return;
    }

    this.advanceOnMain(distDeltaM);
  }

  private advanceOnMain(distDeltaM: number): void {
    const s = this.state;
    const route = this.scenario.route;
    if (s.routeIndex >= route.length - 1) return;

    let remaining = distDeltaM;
    while (remaining > 0 && s.routeIndex < route.length - 1) {
      const from = route[s.routeIndex];
      const to = route[s.routeIndex + 1];
      const segDist = haversineMeters(from[0], from[1], to[0], to[1]);

      if (segDist <= remaining) {
        remaining -= segDist;
        s.routeIndex++;
        s.currentPoint = [...route[s.routeIndex]] as [number, number];
      } else {
        const t = remaining / segDist;
        s.currentPoint = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ];
        remaining = 0;
      }
    }
    s.currentSpeedMs = Math.max(1, distDeltaM);
  }

  private advanceOnDeviation(distDeltaM: number): void {
    const s = this.state;
    const devRoute = this.scenario.deviationRoute!;
    if (s.deviationIndex >= devRoute.length - 1) return;

    let remaining = distDeltaM;
    while (remaining > 0 && s.deviationIndex < devRoute.length - 1) {
      const from = devRoute[s.deviationIndex];
      const to = devRoute[s.deviationIndex + 1];
      const segDist = haversineMeters(from[0], from[1], to[0], to[1]);
      if (segDist <= remaining) {
        remaining -= segDist;
        s.deviationIndex++;
        s.currentPoint = [...devRoute[s.deviationIndex]] as [number, number];
      } else {
        const t = remaining / segDist;
        s.currentPoint = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ];
        remaining = 0;
      }
    }

    if (s.deviationIndex >= devRoute.length - 1) {
      s.isDeviated = false;
      this.snapBack();
    }
  }

  private snapBack(): void {
    const s = this.state;
    const route = this.scenario.route;
    let bestIdx = s.routeIndex;
    let bestDist = Infinity;
    for (let i = s.routeIndex; i < route.length; i++) {
      const d = haversineMeters(s.currentPoint[0], s.currentPoint[1], route[i][0], route[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    s.routeIndex = Math.min(bestIdx, route.length - 1);
    s.currentPoint = [...route[s.routeIndex]] as [number, number];
  }

  private processEvents(km: number): void {
    const s = this.state;
    for (const event of this.scenario.events) {
      const t = event.triggerKm;
      switch (event.type) {
        case "gps_loss":
          if (km >= t && km < t + (event.durationKm ?? 1)) {
            s.currentAccuracy = 999;
            s.eventFlags.gpsLost = true;
          }
          break;
        case "gps_restore":
          if (km >= t && s.currentAccuracy > 500) {
            s.currentAccuracy = event.params?.accuracy ?? 10;
            s.eventFlags.gpsRestored = true;
          }
          break;
        case "route_deviation":
          if (km >= t && km < t + (event.durationKm ?? 1) && !s.isDeviated && this.scenario.deviationRoute) {
            s.isDeviated = true;
            s.deviationIndex = 0;
            s.eventFlags.deviationStarted = true;
          }
          break;
        case "route_return":
          if (km >= t && s.isDeviated) {
            s.isDeviated = false;
            this.snapBack();
            s.eventFlags.deviationEnded = true;
          }
          break;
        case "traffic_stop": {
          const stopEndKm = t + (event.durationKm ?? 0.15);
          if (km >= t && km < stopEndKm) {
            s.isStopped = true;
            s.eventFlags.stopStarted = true;
          } else if (km >= stopEndKm) {
            s.isStopped = false;
            s.eventFlags.stopEnded = true;
          }
          break;
        }
      }
    }
  }
}
