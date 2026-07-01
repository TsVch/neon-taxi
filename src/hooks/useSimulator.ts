// ============================================================================
// GPS Simulator Hook — для тестирования без реального GPS
// ============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import { SIMULATION_ROUTE, GPS_CONSTANTS } from "@/types/taximeter";
import { haversineMeters } from "@/utils/haversine";

export interface UseSimulatorReturn {
  isRunning: boolean;
  currentIndex: number;
  start: (onPoint: (lat: number, lon: number, speed: number) => void) => void;
  stop: () => void;
  speed: number;
  setSpeed: (s: number) => void;
}

export function useSimulator(): UseSimulatorReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(40); // km/h default
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndexRef = useRef(0);
  const callbackRef = useRef<((lat: number, lon: number, speed: number) => void) | null>(null);

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
  }, []);

  const start = useCallback(
    (onPoint: (lat: number, lon: number, speed: number) => void) => {
      stop();
      callbackRef.current = onPoint;
      currentIndexRef.current = 0;
      setCurrentIndex(0);
      setIsRunning(true);

      // Emit first point immediately
      const first = SIMULATION_ROUTE[0];
      if (first) {
        const speedMs = (speed * 1000) / 3600;
        onPoint(first[0], first[1], speedMs);
      }

      // Then emit every 1500ms
      intervalRef.current = setInterval(() => {
        const nextIdx = currentIndexRef.current + 1;

        if (nextIdx >= SIMULATION_ROUTE.length) {
          // Loop back
          currentIndexRef.current = 0;
          setCurrentIndex(0);
          const p = SIMULATION_ROUTE[0];
          if (p) {
            const speedMs = (speed * 1000) / 3600;
            onPoint(p[0], p[1], speedMs);
          }
          return;
        }

        const point = SIMULATION_ROUTE[nextIdx];
        if (!point) return;

        // Add noise: ±0.00002 to coordinates
        const noiseLat = (Math.random() - 0.5) * 0.00004;
        const noiseLon = (Math.random() - 0.5) * 0.00004;

        // Speed variation: ±15%
        const speedVariation = 0.85 + Math.random() * 0.3;
        const speedMs = ((speed * 1000) / 3600) * speedVariation;

        onPoint(point[0] + noiseLat, point[1] + noiseLon, speedMs);

        currentIndexRef.current = nextIdx;
        setCurrentIndex(nextIdx);
      }, GPS_CONSTANTS.SIM_INTERVAL_MS);
    },
    [speed, stop],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isRunning,
    currentIndex,
    start,
    stop,
    speed,
    setSpeed,
  };
}
