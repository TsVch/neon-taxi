// ============================================================================
// GPS Simulator Hook — поддержка сценариев тестирования
// ============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import {
  SIMULATION_ROUTE,
  GPS_CONSTANTS,
} from "@/types/taximeter";
import {
  TEST_SCENARIO,
  ScenarioRunner,
  type ScenarioDef,
  type RunnerState,
} from "@/utils/testScenario";
import { haversineMeters } from "@/utils/haversine";

export interface UseSimulatorReturn {
  isRunning: boolean;
  currentIndex: number;
  start: (onPoint: (lat: number, lon: number, speed: number, accuracy?: number) => void) => void;
  stop: () => void;
  speed: number;
  setSpeed: (s: number) => void;
  /** Режим сценария */
  scenario: ScenarioDef | null;
  setScenario: (s: ScenarioDef | null) => void;
  /** Состояние сценария (для отладки) */
  scenarioState: RunnerState | null;
  /** Флаг — активен ли режим сценария */
  isScenarioMode: boolean;
}

export function useSimulator(): UseSimulatorReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(40); // km/h default
  const [scenario, setScenario] = useState<ScenarioDef | null>(null);
  const [scenarioState, setScenarioState] = useState<RunnerState | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndexRef = useRef(0);
  const callbackRef = useRef<((lat: number, lon: number, speed: number, accuracy?: number) => void) | null>(null);
  const scenarioRef = useRef<ScenarioRunner | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const scenarioModeRef = useRef(false);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    callbackRef.current = null;
    scenarioRef.current = null;
    lastPointRef.current = null;
  }, []);

  const start = useCallback(
    (onPoint: (lat: number, lon: number, speed: number, accuracy?: number) => void) => {
      stop();
      callbackRef.current = onPoint;
      currentIndexRef.current = 0;
      setCurrentIndex(0);
      setIsRunning(true);
      lastPointRef.current = null;
      scenarioModeRef.current = scenario !== null;

      if (scenario) {
        // === РЕЖИМ СЦЕНАРИЯ ===
        const runner = new ScenarioRunner(scenario);
        scenarioRef.current = runner;

        // Первая точка
        const state = runner.getState();
        setScenarioState({ ...state });

        // Скорость эмиссии: ~ 1 км за ~80 сек при 45 км/ч = 1 точка каждые 2 сек
        // На каждый шаг продвигаемся на ~25 метров
        const stepMeters = 25;

        const scenarioInterval = setInterval(() => {
          const currentRunner = scenarioRef.current;
          if (!currentRunner) return;

          const nowState = currentRunner.getState();
          if (nowState.routeIndex >= scenario.route.length - 1) {
            // Доехали до конца
            clearInterval(scenarioInterval);
            if (intervalRef.current === scenarioInterval) {
              intervalRef.current = null;
            }
            setIsRunning(false);
            return;
          }

          // Продвигаем сценарий на шаг
          currentRunner.advance(stepMeters);
          const newState = currentRunner.getState();

          // Отправляем точку
          const acc = newState.currentAccuracy;
          const speedMs = newState.isStopped ? 0 : newState.currentSpeedMs;

          onPoint(newState.currentPoint[0], newState.currentPoint[1], speedMs, acc);
          setScenarioState({ ...newState });

          // Обновляем индекс (для UI)
          currentIndexRef.current = newState.routeIndex;
          setCurrentIndex(newState.routeIndex);

          // Логируем события через eventFlags (безопасное сравнение по копии)
          const km = newState.distanceM / 1000;
          const flags = newState.eventFlags;

          if (flags.gpsLost) {
            console.log(`[SCENARIO] ⚠️ GPS LOSS at ${km.toFixed(1)} км`);
          }
          if (flags.gpsRestored) {
            console.log(`[SCENARIO] ✅ GPS RESTORE at ${km.toFixed(1)} км`);
          }
          if (flags.deviationStarted) {
            console.log(`[SCENARIO] 🚗 ROUTE DEVIATION at ${km.toFixed(1)} км`);
          }
          if (flags.deviationEnded) {
            console.log(`[SCENARIO] 🔄 RETURN TO ROUTE at ${km.toFixed(1)} км`);
          }
          if (flags.stopStarted) {
            console.log(`[SCENARIO] 🛑 STOP at ${km.toFixed(1)} км`);
          }
          if (flags.stopEnded) {
            console.log(`[SCENARIO] 🚀 GO at ${km.toFixed(1)} км`);
          }
        }, GPS_CONSTANTS.SIM_INTERVAL_MS);

        intervalRef.current = scenarioInterval;
      } else {
        // === ОБЫЧНЫЙ РЕЖИМ (старый) ===
        const first = SIMULATION_ROUTE[0];
        if (first) {
          const speedMs = (speed * 1000) / 3600;
          onPoint(first[0], first[1], speedMs, 10);
        }

        intervalRef.current = setInterval(() => {
          const nextIdx = currentIndexRef.current + 1;

          if (nextIdx >= SIMULATION_ROUTE.length) {
            currentIndexRef.current = 0;
            setCurrentIndex(0);
            const p = SIMULATION_ROUTE[0];
            if (p) {
              const speedMs = (speed * 1000) / 3600;
              onPoint(p[0], p[1], speedMs, 10);
            }
            return;
          }

          const point = SIMULATION_ROUTE[nextIdx];
          if (!point) return;

          const noiseLat = (Math.random() - 0.5) * 0.00004;
          const noiseLon = (Math.random() - 0.5) * 0.00004;
          const speedVariation = 0.85 + Math.random() * 0.3;
          const speedMs = ((speed * 1000) / 3600) * speedVariation;

          onPoint(point[0] + noiseLat, point[1] + noiseLon, speedMs, 10);

          currentIndexRef.current = nextIdx;
          setCurrentIndex(nextIdx);
        }, GPS_CONSTANTS.SIM_INTERVAL_MS);
      }
    },
    [speed, stop, scenario],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const isScenarioMode = scenario !== null;

  return {
    isRunning,
    currentIndex,
    start,
    stop,
    speed,
    setSpeed,
    scenario,
    setScenario,
    scenarioState,
    isScenarioMode,
  };
}
