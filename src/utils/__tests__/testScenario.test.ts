// ============================================================================
// Автотест: имитация реальной поездки с пропажей GPS и нештатными ситуациями
// ============================================================================
//
// Тест создаёт ScenarioRunner для TEST_SCENARIO, прогоняет всю 10-км поездку
// и проверяет корректность каждого этапа:
//   0–2  км — нормальный GPS
//   2–3  км — пропажа GPS (accuracy=999)
//   3–5  км — GPS восстановлен
//   5–6.5 км — отклонение от маршрута
//   7.5–7.7 км — остановка (скорость=0)
//   7.7–10  км — финиш
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioRunner, TEST_SCENARIO } from "../testScenario";
import { haversineMeters } from "../haversine";
import type { ScenarioDef } from "../testScenario";

describe("ScenarioRunner — полная имитация поездки", () => {
  let runner: ScenarioRunner;

  beforeAll(() => {
    runner = new ScenarioRunner(TEST_SCENARIO);
  });

  it("1. Начальное состояние: старт на первой точке, скорость = defaultSpeedKmh, accuracy = 10м", () => {
    const state = runner.getState();

    expect(state.routeIndex).toBe(0);
    expect(state.distanceM).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.currentAccuracy).toBe(10);
    expect(state.isDeviated).toBe(false);
    expect(state.isStopped).toBe(false);

    // Скорость: 60 км/ч = 16.67 м/с
    const expectedSpeedMs = (TEST_SCENARIO.defaultSpeedKmh * 1000) / 3600;
    expect(state.currentSpeedMs).toBeCloseTo(expectedSpeedMs, 1);

    // Стартовая точка — Красная площадь
    expect(state.currentPoint[0]).toBeCloseTo(55.7537, 2);
    expect(state.currentPoint[1]).toBeCloseTo(37.6208, 2);

    // startPoint/endPoint
    expect(runner.startPoint).not.toBeNull();
    expect(runner.endPoint).not.toBeNull();
    expect(runner.plannedRoute.totalDistanceM).toBeGreaterThan(9000);
  });

  it("2. Этап 0–2 км: нормальная поездка, accuracy ~10м, на основном маршруте", () => {
    const stepM = 25;
    const stepsFor2km = Math.floor(2000 / stepM); // 80 шагов

    for (let i = 0; i < stepsFor2km; i++) {
      runner.advance(stepM);
    }

    const state = runner.getState();

    // Должны быть на ~2 км
    expect(state.distanceM).toBeGreaterThanOrEqual(2000);
    expect(state.distanceM).toBeLessThanOrEqual(2100);
    expect(state.currentAccuracy).toBe(10);
    expect(state.isDeviated).toBe(false);
    expect(state.isStopped).toBe(false);

    // Должны продвинуться по маршруту
    expect(state.routeIndex).toBeGreaterThan(10);
  });

  it("3. Этап 2–3 км: ПРОПАЖА GPS (accuracy=999), включение Dead Reckoning", () => {
    const stepM = 25;
    const stepsFor1km = Math.floor(1000 / stepM);

    let sawGpsLoss = false;

    for (let i = 0; i < stepsFor1km; i++) {
      runner.advance(stepM);
      const state = runner.getState();
      if (state.eventFlags.gpsLost) {
        sawGpsLoss = true;
        expect(state.currentAccuracy).toBe(999);
      }
    }

    const state = runner.getState();
    expect(sawGpsLoss).toBe(true);
    expect(state.distanceM).toBeGreaterThanOrEqual(3000);
    expect(state.currentAccuracy).toBeGreaterThan(500); // ещё в GPS loss
  });

  it("4. Этап 3–5 км: GPS восстановлен (accuracy=15), возврат к нормальной поездке", () => {
    const stepM = 25;
    const stepsFor2km = Math.floor(2000 / stepM);

    let sawRestore = false;

    for (let i = 0; i < stepsFor2km; i++) {
      runner.advance(stepM);
      const state = runner.getState();
      if (state.eventFlags.gpsRestored) {
        sawRestore = true;
      }
    }

    const state = runner.getState();
    expect(sawRestore).toBe(true);
    expect(state.currentAccuracy).toBeLessThanOrEqual(15);
    expect(state.isDeviated).toBe(false);
    expect(state.distanceM).toBeGreaterThanOrEqual(5000);
  });

  it("5. Этап 5–6.5 км: ОТКЛОНЕНИЕ от маршрута", () => {
    const stepM = 25;
    const stepsFor1_5km = Math.floor(1500 / stepM);

    let sawDeviation = false;

    for (let i = 0; i < stepsFor1_5km; i++) {
      runner.advance(stepM);
      const state = runner.getState();
      if (state.eventFlags.deviationStarted) {
        sawDeviation = true;
        expect(state.isDeviated).toBe(true);
      }
    }

    const state = runner.getState();
    expect(sawDeviation).toBe(true);
    expect(state.distanceM).toBeGreaterThanOrEqual(6500);

    // Должны вернуться на маршрут
    expect(state.isDeviated).toBe(false);
    expect(state.currentAccuracy).toBe(10);
  });

  it("6. Этап 7.5–7.7 км: ОСТАНОВКА (скорость=0)", () => {
    const stepM = 25;
    // Пропускаем до 7.5 км
    while (runner.getState().distanceM < 7400) {
      runner.advance(stepM);
    }

    let sawStop = false;
    let sawGo = false;

    // Проходим участок 7.5–7.8 км
    for (let i = 0; i < 15; i++) {
      runner.advance(stepM);
      const state = runner.getState();

      if (state.eventFlags.stopStarted) {
        sawStop = true;
        expect(state.isStopped).toBe(true);
        expect(state.currentSpeedMs).toBe(0);
      }
      if (state.eventFlags.stopEnded) {
        sawGo = true;
        expect(state.isStopped).toBe(false);
      }
    }

    const state = runner.getState();
    expect(sawStop).toBe(true);
    expect(sawGo).toBe(true);
    expect(state.distanceM).toBeGreaterThanOrEqual(7700);
  });

  it("7. Финиш: поездка завершается около отметки 10 км", () => {
    const stepM = 25;

    // Двигаемся до конца маршрута
    let finalState = runner.getState();
    while (finalState.routeIndex < TEST_SCENARIO.route.length - 1) {
      runner.advance(stepM);
      finalState = runner.getState();

      // Не зацикливаемся
      if (finalState.distanceM > 12000) break;
    }

    expect(finalState.routeIndex).toBeGreaterThanOrEqual(
      TEST_SCENARIO.route.length - 2,
    );
    expect(finalState.distanceM).toBeGreaterThanOrEqual(9500);

    // Финальная точка — около Поклонной горы
    const endPoint = runner.endPoint;
    expect(endPoint).not.toBeNull();
    if (endPoint) {
      const distToEnd = haversineMeters(
        finalState.currentPoint[0],
        finalState.currentPoint[1],
        endPoint[0],
        endPoint[1],
      );
      // Должны быть в пределах 500м от финиша
      expect(distToEnd).toBeLessThan(500);
    }
  });
});

describe("ScenarioRunner — пограничные случаи", () => {
  it("Короткий сценарий с 2 точками работает корректно", () => {
    const shortScenario: ScenarioDef = {
      name: "Short test",
      description: "2 точки",
      route: [[55.75, 37.61], [55.76, 37.62]],
      defaultSpeedKmh: 40,
      fromLabel: "A",
      toLabel: "B",
      events: [],
    };

    const runner = new ScenarioRunner(shortScenario);
    expect(runner.startPoint).toEqual([55.75, 37.61]);
    expect(runner.endPoint).toEqual([55.76, 37.62]);
    expect(runner.plannedRoute.totalDistanceM).toBeGreaterThan(0);

    // Проходим весь маршрут
    for (let i = 0; i < 100; i++) {
      runner.advance(25);
    }

    const state = runner.getState();
    expect(state.distanceM).toBeGreaterThan(0);
    expect(state.routeIndex).toBeGreaterThanOrEqual(0);
  });

  it("scenarioToPlannedRoute создаёт корректный PlannedRoute", async () => {
    const { scenarioToPlannedRoute } = await import("../testScenario");

    const coords: Array<[number, number]> = [
      [55.75, 37.61],
      [55.76, 37.62],
      [55.77, 37.63],
    ];

    const planned = scenarioToPlannedRoute(coords);

    expect(planned.coords).toEqual(coords);
    expect(planned.cumulativeM.length).toBe(3);
    expect(planned.cumulativeM[0]).toBe(0);
    expect(planned.totalDistanceM).toBeGreaterThan(0);
    expect(planned.totalDurationS).toBeGreaterThan(0);
  });

  it("Сброс (reset) возвращает в начальное состояние", () => {
    const runner = new ScenarioRunner(TEST_SCENARIO);

    // Продвигаемся на 2 км
    for (let i = 0; i < 80; i++) {
      runner.advance(25);
    }

    const beforeReset = runner.getState();
    expect(beforeReset.distanceM).toBeGreaterThan(0);

    runner.reset();
    const afterReset = runner.getState();

    expect(afterReset.distanceM).toBe(0);
    expect(afterReset.routeIndex).toBe(0);
    expect(afterReset.progress).toBe(0);
    expect(afterReset.currentAccuracy).toBe(10);
  });
});
