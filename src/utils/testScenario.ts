// ============================================================================
// Test Scenario — 35km имитация поездки с кейсами: пропажа GPS, отклонение
// ============================================================================
//
// Маршрут: Москва (Кремль → Ленинградский пр-т → МКАД → Алтуфьевское ш.)
// Длина: ~35 км, время: ~50 мин при средней скорости 42 км/ч
//
// Сценарий по этапам:
//   Этап 1 — нормальная поездка по МКАД (0-15 км)
//   Этап 2 — ПРОПАЖА GPS (15-17 км) — проверка DR + IMU
//   Этап 3 — восстановление GPS, норма (17-25 км)
//   Этап 4 — ОТКЛОНЕНИЕ от маршрута (25-28 км) — проверка auto-replan
//   Этап 5 — возврат на маршрут / финиш (28-35 км)
// ============================================================================

import { haversineMeters, pathDistanceMeters } from "./haversine";

// ---------------------------------------------------------------------------
// Типы сценария
// ---------------------------------------------------------------------------

export type ScenarioEventType =
  | "gps_loss"       // GPS сигнал пропадает на N секунд
  | "gps_restore"    // GPS сигнал восстанавливается
  | "route_deviation"// координаты уходят от основного маршрута
  | "route_return"   // координаты возвращаются на маршрут
  | "traffic_stop"   // остановка на N секунд (светофор/пробка)
  | "speed_bump"     // изменение скорости;

export interface ScenarioEvent {
  type: ScenarioEventType;
  triggerKm: number;   // срабатывает на этом километре пути
  durationKm?: number; // длительность события в километрах
  params?: Record<string, number>;
}

export interface ScenarioDef {
  name: string;
  description: string;
  route: Array<[number, number]>;   // [lat, lon]
  deviationRoute?: Array<[number, number]>; // ответвление для теста отклонения
  events: ScenarioEvent[];
  defaultSpeedKmh: number;
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/** Линейная интерполяция между двумя точками */
function lerp(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** "Уплотняет" массив точек, добавляя промежуточные (каждые ~100м) */
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

/** Вычисляет кумулятивные расстояния от старта */
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

// ---------------------------------------------------------------------------
// Точки маршрута (основные — разреженные, будут уплотнены)
// ---------------------------------------------------------------------------
//
// Маршрут: Москва центр → Ленинградский пр-т → МКАД → Алтуфьевское ш.
// Ориентир — реальные координаты перекрёстков с карты.
//
const MAIN_WAYPOINTS: Array<[number, number]> = [
  // 0-2 км: центр
  [55.7558, 37.6173],  // Красная площадь (старт)
  [55.7650, 37.6060],  // Тверская ул., Манежная пл.
  [55.7750, 37.5900],  // Триумфальная пл.

  // 2-6 км: Ленинградский пр-т (начало)
  [55.7830, 37.5770],  // Белорусский вокзал
  [55.7900, 37.5600],  // ул. Горького
  [55.8000, 37.5450],  // Динамо
  [55.8090, 37.5320],  // Петровский парк

  // 6-12 км: Ленинградский пр-т (середина)
  [55.8200, 37.5180],  // Сокол (ст. метро)
  [55.8300, 37.5050],  // Аэропорт
  [55.8400, 37.4950],  // Гражданская
  [55.8480, 37.4860],  // Войковская

  // 12-15 км: Ленинградское шоссе → МКАД
  [55.8600, 37.4750],  // Михалково
  [55.8730, 37.4650],  // Головинский р-н
  [55.8850, 37.4600],  // Левобережный
  [55.8950, 37.4550],  // Химки

  // 15-18 км: МКАД (северо-запад)
  [55.9050, 37.4650],  // Выезд на МКАД (внешнее кольцо)
  [55.9120, 37.4850],  // МКАД, 75-й км
  [55.9180, 37.5050],  // МКАД, поворот на Дмитровку

  // 18-22 км: МКАД (север)
  [55.9220, 37.5300],  // МКАД, Дмитровское ш.
  [55.9260, 37.5580],  // МКАД, 76-й км
  [55.9280, 37.5850],  // МКАД, Алтуфьевское ш. (север)

  // 22-28 км: МКАД (северо-восток)
  [55.9300, 37.6150],  // МКАД, Лианозово
  [55.9300, 37.6450],  // МКАД, 79-й км
  [55.9280, 37.6750],  // МКАД, Ярославское ш.
  [55.9250, 37.7050],  // МКАД, Северянин
  [55.9200, 37.7350],  // МКАД, 85-й км

  // 28-33 км: МКАД → съезд на Щёлковское ш.
  [55.9150, 37.7650],  // МКАД, Щёлковское ш.
  [55.9100, 37.7900],  // МКАД, 90-й км
  [55.9050, 37.8150],  // МКАД, Ивановское
  [55.8980, 37.8400],  // МКАД, Носовиха

  // 33-35 км: финиш
  [55.8920, 37.8600],  // МКАД 95-й км
  [55.8860, 37.8780],  // поворот в Кожухово
  [55.8800, 37.8900],  // Конечная точка
];

// Ответвление для теста отклонения от маршрута
const DEVIATION_WAYPOINTS: Array<[number, number]> = [
  [55.9050, 37.4650],  // Точка съезда (та же, что 15-й км основного маршрута)
  [55.9000, 37.4700],  // Съезд с МКАД на местную дорогу
  [55.8950, 37.4750],  // Уход в сторону (параллельно МКАД, но не по нему)
  [55.8900, 37.4800],  // Отклонение ~300м от МКАД
  [55.8850, 37.4850],  // Продолжение движения вне маршрута
  [55.8800, 37.4900],  // Максимальное отклонение ~400м
  [55.8780, 37.4950],  // Начало возврата
  [55.8820, 37.5000],  // Возврат ближе к МКАД
  [55.8900, 37.5050],  // Выезд обратно на МКАД
];

// ---------------------------------------------------------------------------
// Сценарий
// ---------------------------------------------------------------------------

export const TEST_SCENARIO: ScenarioDef = {
  name: "Москва → МКАД, 35 км",
  description:
    "Полная имитация поездки: 35 км, ~50 мин. " +
    "Этап 1: норм. GPS · " +
    "Этап 2: пропажа GPS (DR) · " +
    "Этап 3: норм. GPS · " +
    "Этап 4: отклонение от маршрута · " +
    "Этап 5: возврат и финиш.",
  route: densifyRoute(MAIN_WAYPOINTS, 100),
  deviationRoute: densifyRoute(DEVIATION_WAYPOINTS, 50),
  defaultSpeedKmh: 42,
  events: [
    // ЭТАП 1 (0-15 км): нормальная поездка, 42 км/ч
    // ЭТАП 2 (15-17 км): пропажа GPS (2 км без сигнала)
    {
      type: "gps_loss",
      triggerKm: 15.0,
      durationKm: 2.0,
      params: { accuracy: 999 },
    },
    {
      type: "gps_restore",
      triggerKm: 17.0,
      params: { accuracy: 15 },
    },
    // ЭТАП 3 (17-25 км): нормальная поездка
    // ЭТАП 4 (25-27 км): отклонение от маршрута
    {
      type: "route_deviation",
      triggerKm: 25.0,
      durationKm: 2.5,
    },
    {
      type: "route_return",
      triggerKm: 27.5,
    },
    // ЭТАП 5 (27-35 км): норма до финиша
    // Короткая остановка на светофоре (на 30-м км)
    {
      type: "traffic_stop",
      triggerKm: 30.0,
      durationKm: 0.15, // ~150 метров (около 10 сек при 50 км/ч)
    },
  ],
};

// ---------------------------------------------------------------------------
// ScenarioRunner — управляет состоянием сценария в реальном времени
// ---------------------------------------------------------------------------

export interface RunnerState {
  /** Индекс текущей точки в основном маршруте */
  routeIndex: number;
  /** Текущая точка [lat, lon] */
  currentPoint: [number, number];
  /** Актуальная скорость в м/с */
  currentSpeedMs: number;
  /** Точность GPS: 10 = good, 999 = dead_reck */
  currentAccuracy: number;
  /** Активно ли отклонение от маршрута */
  isDeviated: boolean;
  /** Индекс в deviationRoute (если активно) */
  deviationIndex: number;
  /** Пройденная дистанция в метрах */
  distanceM: number;
  /** Сколько % маршрута пройдено (0-1) */
  progress: number;
  /** Активна ли остановка */
  isStopped: boolean;
  /** Флаги событий для логирования (сбрасываются после каждого шага) */
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
  private deviationCumulative: number[] = [];
  private totalDistM: number;
  private stepMeters = 25;
  private state: RunnerState;

  constructor(scenario: ScenarioDef = TEST_SCENARIO) {
    this.scenario = scenario;
    this.cumulative = cumulativeMeters(scenario.route);
    this.totalDistM = this.cumulative[this.cumulative.length - 1] || 1;
    if (scenario.deviationRoute && scenario.deviationRoute.length > 1) {
      this.deviationCumulative = cumulativeMeters(scenario.deviationRoute);
    }
    this.state = this.initialState();
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

  /** Сброс сценария в начальное состояние */
  reset(): void {
    this.state = this.initialState();
  }

  /** Получить копию текущего состояния (для сравнения на изменения) */
  getState(): RunnerState {
    return {
      ...this.state,
      currentPoint: [...this.state.currentPoint],
    };
  }

  /** Шаг сценария: перемещение на шаг вперёд */
  advance(distDeltaM: number): void {
    const s = this.state;
    if (s.routeIndex >= this.scenario.route.length - 1) return;

    // Сбрасываем флаги событий
    s.eventFlags = {
      gpsLost: false,
      gpsRestored: false,
      deviationStarted: false,
      deviationEnded: false,
      stopStarted: false,
      stopEnded: false,
    };

    s.distanceM += distDeltaM;
    const km = s.distanceM / 1000;
    s.progress = Math.min(1, s.distanceM / this.totalDistM);

    // Проверяем активные события
    this.processEvents(km);

    // Если активна остановка — не двигаемся (distanceM уже увеличена, km растёт)
    if (s.isStopped) {
      s.currentSpeedMs = 0;
      return;
    }

    // Если активно отклонение — движемся по deviationRoute
    if (s.isDeviated && this.scenario.deviationRoute) {
      this.advanceOnDeviationRoute(distDeltaM);
      return;
    }

    // Основной маршрут
    this.advanceOnMainRoute(distDeltaM);
  }

  private advanceOnMainRoute(distDeltaM: number): void {
    const s = this.state;
    const route = this.scenario.route;
    if (s.routeIndex >= route.length - 1) return;

    // Считаем, сколько метров нужно пройти по маршруту
    let remaining = distDeltaM;
    while (remaining > 0 && s.routeIndex < route.length - 1) {
      const from = route[s.routeIndex];
      const to = route[s.routeIndex + 1];
      const segDist = haversineMeters(from[0], from[1], to[0], to[1]);

      if (segDist <= remaining) {
        remaining -= segDist;
        s.routeIndex++;
        if (s.routeIndex < route.length) {
          s.currentPoint = [...route[s.routeIndex]] as [number, number];
        }
      } else {
        const t = remaining / segDist;
        s.currentPoint = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ];
        remaining = 0;
      }
    }

    // Скорость = пройденная дистанция за шаг
    s.currentSpeedMs = Math.max(1, distDeltaM); // минимум 1 м/с
  }

  private advanceOnDeviationRoute(distDeltaM: number): void {
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
        if (s.deviationIndex < devRoute.length) {
          s.currentPoint = [...devRoute[s.deviationIndex]] as [number, number];
        }
      } else {
        const t = remaining / segDist;
        s.currentPoint = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ];
        remaining = 0;
      }
    }

    // Когда отклонение закончилось — возвращаемся на основной маршрут
    if (s.deviationIndex >= devRoute.length - 1) {
      s.isDeviated = false;
      // Находим ближайшую точку на основном маршруте
      this.snapBackToMainRoute();
    }
  }

  private snapBackToMainRoute(): void {
    const s = this.state;
    const route = this.scenario.route;
    let bestIdx = s.routeIndex;
    let bestDist = Infinity;

    // Ищем ближайшую точку на основном маршруте
    for (let i = s.routeIndex; i < route.length; i++) {
      const d = haversineMeters(
        s.currentPoint[0], s.currentPoint[1],
        route[i][0], route[i][1],
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    s.routeIndex = Math.min(bestIdx, route.length - 1);
    s.currentPoint = [...route[s.routeIndex]] as [number, number];
  }

  private processEvents(km: number): void {
    const s = this.state;

    for (const event of this.scenario.events) {
      const triggerKm = event.triggerKm;

      switch (event.type) {
        case "gps_loss":
          if (km >= triggerKm && km < triggerKm + (event.durationKm ?? 2)) {
            s.currentAccuracy = 999;
            s.eventFlags.gpsLost = true;
          }
          break;

        case "gps_restore":
          if (km >= triggerKm && s.currentAccuracy > 500) {
            s.currentAccuracy = event.params?.accuracy ?? 10;
            s.eventFlags.gpsRestored = true;
          }
          break;

        case "route_deviation":
          if (
            km >= triggerKm &&
            km < triggerKm + (event.durationKm ?? 2) &&
            !s.isDeviated &&
            this.scenario.deviationRoute
          ) {
            s.isDeviated = true;
            s.deviationIndex = 0;
            s.eventFlags.deviationStarted = true;
          }
          break;

        case "route_return":
          if (km >= triggerKm && s.isDeviated) {
            s.isDeviated = false;
            this.snapBackToMainRoute();
            s.eventFlags.deviationEnded = true;
          }
          break;

        case "traffic_stop": {
          const stopEndKm = triggerKm + (event.durationKm ?? 0.15);
          // distanceM уже увеличена до начала processEvents, km растёт
          if (km >= triggerKm && km < stopEndKm) {
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
