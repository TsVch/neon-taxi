// ============================================================================
// Multi-tier GPS Hook with Dead Reckoning + IMU
// ============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  GpsQuality,
  GpsPoint,
  SmoothGpsState,
  DeadReckoningState,
  LogEvent,
  IMUSnapshot,
} from "@/types/taximeter";
import { GPS_CONSTANTS } from "@/types/taximeter";
import { haversineMeters } from "@/utils/haversine";
import { useIMU } from "./useIMU";

export interface UseGPSReturn {
  smoothState: SmoothGpsState | null;
  deadReckoning: DeadReckoningState;
  recentPoints: GpsPoint[];
  isWatching: boolean;
  startWatching: () => void;
  stopWatching: () => void;
  retryWatching: () => void;
  addSimulatedPoint: (lat: number, lon: number, speed: number, accuracy?: number) => void;
  events: LogEvent[];
  addEvent: (type: LogEvent["type"], message: string, data?: Record<string, unknown>) => void;
  clearEvents: () => void;
  totalDistanceM: number;
  isSimulating: boolean;
  setSimulating: (v: boolean) => void;
  imuSupported: boolean;
  imuActive: boolean;
  imuPermissionGranted: boolean;
  lastError: string | null;
}

let eventIdCounter = 0;

function classifyAccuracy(accuracy: number): GpsQuality {
  if (accuracy <= GPS_CONSTANTS.GOOD_THRESHOLD) return "good";
  if (accuracy <= GPS_CONSTANTS.DEGRADED_THRESHOLD) return "degraded";
  if (accuracy <= GPS_CONSTANTS.POOR_THRESHOLD) return "poor";
  return "dead_reck";
}

function createEvent(
  type: LogEvent["type"],
  message: string,
  data?: Record<string, unknown>,
): LogEvent {
  return {
    id: `evt-${++eventIdCounter}`,
    timestamp: Date.now(),
    type,
    message,
    data,
  };
}

export function useGPS(): UseGPSReturn {
  // IMU (акселерометр + компас) для улучшенного Dead Reckoning
  const imu = useIMU();

  const [smoothState, setSmoothState] = useState<SmoothGpsState | null>(null);
  const [deadReckoning, setDeadReckoning] = useState<DeadReckoningState>({
    active: false,
    elapsedSinceLastGPS: 0,
    lastSpeed: 0,
    decayFactor: 1,
    estimatedLat: 0,
    estimatedLon: 0,
    heading: null,
    imuHeading: null,
    imuMoving: null,
    imuSupported: false,
  });
  const [recentPoints, setRecentPoints] = useState<GpsPoint[]>([]);
  const [isWatching, setIsWatching] = useState(false);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Refs for mutable state
  const watchIdRef = useRef<number | null>(null);
  const lastGoodPointRef = useRef<{ lat: number; lon: number } | null>(null);
  const smoothLatRef = useRef(0);
  const smoothLonRef = useRef(0);
  const smoothSpeedRef = useRef(0);
  const lastTimestampRef = useRef<number>(0);
  const totalDistRef = useRef(0);
  const isFirstFixRef = useRef(true);
  const drTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drLogCountRef = useRef(0);
  const eventsRef = useRef<LogEvent[]>([]);
  const smoothStateRef = useRef<SmoothGpsState | null>(null);
  const deadReckoningRef = useRef<DeadReckoningState>({
    active: false,
    elapsedSinceLastGPS: 0,
    lastSpeed: 0,
    decayFactor: 1,
    estimatedLat: 0,
    estimatedLon: 0,
    heading: null,
    imuHeading: null,
    imuMoving: null,
    imuSupported: false,
  });
  const lastGpsTimeRef = useRef<number>(Date.now());
  const imuSnapshotRef = useRef<IMUSnapshot | null>(null);

  const addEvent = useCallback(
    (type: LogEvent["type"], message: string, data?: Record<string, unknown>) => {
      const evt = createEvent(type, message, data);
      eventsRef.current = [...eventsRef.current.slice(-199), evt];
      setEvents(eventsRef.current);
    },
    [],
  );

  const clearEvents = useCallback(() => {
    eventsRef.current = [];
    setEvents([]);
  }, []);

  // Синхронизируем IMU snapshot в ref для доступа из интервала DR
  useEffect(() => {
    imuSnapshotRef.current = imu.snapshot;
  }, [imu.snapshot]);

  // Dead Reckoning timer — runs every 1 second when no GPS updates
  const startDRTimer = useCallback(() => {
    if (drTimerRef.current) return;
    drLogCountRef.current = 0;

    drTimerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsedSinceLastGPS = (now - lastGpsTimeRef.current) / 1000;
      const isLogTick = drLogCountRef.current % 5 === 0; // Логируем DR каждые 5с
      drLogCountRef.current++;

      if (elapsedSinceLastGPS >= GPS_CONSTANTS.DR_TIMEOUT_MS / 1000) {
        // Получаем последние данные с IMU
        const imuSnap = imuSnapshotRef.current;
        const imuHeading = imuSnap?.heading ?? null;
        const imuMoving = imuSnap?.isMoving ?? null;
        const imuAccel = imuSnap?.accelerationMagnitude ?? 0;
        const timeDelta = 1; // 1 second interval

        // Определяем heading: IMU компас приоритетнее последнего GPS курса
        const effectiveHeading = imuHeading ?? deadReckoningRef.current.heading ?? 0;

        // Определяем скорость через IMU
        let drSpeed: number;
        let distanceDr: number;

        if (imuMoving === false) {
          // IMU говорит, что устройство НЕ ДВИЖЕТСЯ — дистанцию не накапливаем
          drSpeed = 0;
          distanceDr = 0;
        } else {
          // Устройство движется или IMU недоступен — оцениваем скорость
          if (imuAccel > 0.8) {
            // Активное ускорение — скорость растёт
            drSpeed = Math.min(
              smoothSpeedRef.current * (1 + imuAccel * 0.15),
              GPS_CONSTANTS.MAX_SPEED_M_S,
            );
          } else if (imuAccel < 0.15) {
            // Очень низкая вибрация — замедление, ускоренный спад
            drSpeed = smoothSpeedRef.current * Math.max(deadReckoningRef.current.decayFactor, 0.5);
          } else {
            // Нормальное движение — стандартный спад
            drSpeed = smoothSpeedRef.current * Math.max(deadReckoningRef.current.decayFactor, 0.7);
          }

          distanceDr = drSpeed * timeDelta;
        }

        // Estimate new position using effective heading
        const headingRad = (effectiveHeading * Math.PI) / 180;

        const latDelta =
          (distanceDr * Math.cos(headingRad)) / 111320;
        const lonDelta =
          (distanceDr * Math.sin(headingRad)) /
          (111320 * Math.cos((smoothLatRef.current * Math.PI) / 180));

        const estLat = smoothLatRef.current + latDelta;
        const estLon = smoothLonRef.current + lonDelta;

        const newDR: DeadReckoningState = {
          active: true,
          elapsedSinceLastGPS,
          lastSpeed: smoothSpeedRef.current,
          decayFactor: deadReckoningRef.current.decayFactor,
          estimatedLat: estLat,
          estimatedLon: estLon,
          heading: effectiveHeading,
          imuHeading,
          imuMoving,
          imuSupported: imu.isSupported,
        };

        deadReckoningRef.current = newDR;
        setDeadReckoning(newDR);

        // Accumulate distance traveled during DR (только если IMU подтверждает движение)
        if (distanceDr >= GPS_CONSTANTS.MIN_MOVEMENT_M) {
          totalDistRef.current += distanceDr;
          setTotalDistanceM(totalDistRef.current);
        }

        // Update smooth state with DR estimate
        const drState: SmoothGpsState = {
          lat: estLat,
          lon: estLon,
          accuracy: 999,
          speed: drSpeed,
          heading: effectiveHeading,
          timestamp: now,
          quality: "dead_reck",
        };
        smoothStateRef.current = drState;
        setSmoothState(drState);

        // Логируем DR только каждые 5с (не каждый 1с)
        if (isLogTick) {
          const drMsg = imuMoving === false
            ? `DR: СТОП (IMU: нет движения)`
            : `DR: ${drSpeed.toFixed(1)} м/с, ${effectiveHeading.toFixed(0)}°${imuHeading !== null ? ' (IMU)' : ''}${imuAccel > 0.8 ? ' ускорение' : ''}`;
          addEvent("dr", drMsg, {
            elapsedSinceLastGPS,
            drSpeed,
            decayFactor: deadReckoningRef.current.decayFactor,
            imuHeading,
            imuMoving,
            imuAccel,
          });
        }
      } else {
        // Not yet in DR mode, but update elapsed time and IMU info
        const imuSnap = imuSnapshotRef.current;
        const newDR: DeadReckoningState = {
          ...deadReckoningRef.current,
          elapsedSinceLastGPS,
          active: false,
          imuHeading: imuSnap?.heading ?? null,
          imuMoving: imuSnap?.isMoving ?? null,
          imuSupported: imu.isSupported,
        };
        deadReckoningRef.current = newDR;
        setDeadReckoning(newDR);
      }
    }, 1000);
  }, [addEvent, imu.isSupported]);

  const stopDRTimer = useCallback(() => {
    if (drTimerRef.current) {
      clearInterval(drTimerRef.current);
      drTimerRef.current = null;
    }
  }, []);

  // Process a GPS position update
  const processPosition = useCallback(
    (
      lat: number,
      lon: number,
      accuracy: number,
      speed: number | null,
      heading: number | null,
      timestamp: number,
      isSim: boolean,
    ) => {
      const quality = isSim
        ? (accuracy > GPS_CONSTANTS.POOR_THRESHOLD ? "dead_reck" : "sim")
        : classifyAccuracy(accuracy);

      const gpsPoint: GpsPoint = {
        lat,
        lon,
        accuracy,
        speed,
        heading,
        timestamp,
        quality,
      };

      setRecentPoints((prev) => [...prev.slice(-99), gpsPoint]);

      if (quality === "dead_reck" && !isSim) {
        // GPS rejected (>500m accuracy) — НЕ сбрасываем DR таймер
        addEvent("gps", `GPS отклонён: точность ${accuracy.toFixed(0)}м`, { accuracy });
        return;
      }

      // Update last GPS time (resets DR timer) — только для ПРИНЯТЫХ точек
      lastGpsTimeRef.current = timestamp;

      // Симулированные точки пропускают jump guard и spoofing — они синтетические
      if (!isSim) {
        // Jump Guard: detect speed jumps > 55 m/s
        if (
          !isFirstFixRef.current &&
          speed !== null &&
          speed > GPS_CONSTANTS.MAX_SPEED_M_S
        ) {
          addEvent("warn", `Скачок скорости обнаружен: ${(speed * 3.6).toFixed(0)} км/ч — игнорируем`, {
            speed,
            maxAllowed: GPS_CONSTANTS.MAX_SPEED_M_S,
          });
          // Don't update smooth state — use last good point
          if (lastGoodPointRef.current) {
            return;
          }
        }

        // GPS Spoofing detection: check if position is unreasonably far
        if (
          !isFirstFixRef.current &&
          lastGoodPointRef.current
        ) {
          const distFromLast = haversineMeters(
            lastGoodPointRef.current.lat,
            lastGoodPointRef.current.lon,
            lat,
            lon,
          );
          const timeDelta = (timestamp - lastTimestampRef.current) / 1000;
          const maxAllowedDist = GPS_CONSTANTS.MAX_SPEED_M_S * timeDelta * 1.5;

          if (distFromLast > maxAllowedDist && timeDelta > 1) {
            addEvent(
              "warn",
              `Телепортация обнаружена: ${distFromLast.toFixed(0)}м за ${timeDelta.toFixed(1)}с — откат к последней точке`,
              { distFromLast, maxAllowedDist, timeDelta },
            );
            // Don't update — keep last good point
            return;
          }
        }
      }

      // Process based on quality tier
      // Симулированная потеря GPS (quality='dead_reck' + isSim=true) обрабатывается как хороший сигнал,
      // но с сохранением качества 'dead_reck' в smoothState для корректного отображения в UI
      if (quality === "good" || quality === "sim" || (quality === "dead_reck" && isSim)) {
        // Tier 1: Accept position and speed
        if (isFirstFixRef.current) {
          smoothLatRef.current = lat;
          smoothLonRef.current = lon;
          smoothSpeedRef.current = speed ?? 0;
          isFirstFixRef.current = false;
          lastGoodPointRef.current = { lat, lon };

          const initialState: SmoothGpsState = {
            lat,
            lon,
            accuracy,
            speed: speed ?? 0,
            heading,
            timestamp,
            quality,
          };
          smoothStateRef.current = initialState;
          setSmoothState(initialState);
          setLastError(null); // очищаем ошибку при первом fix'е
          addEvent("gps", `Первый GPS fix: точность ${accuracy.toFixed(0)}м`, {
            lat,
            lon,
            accuracy,
          });
        } else {
          // EMA smoothing
          const alpha = GPS_CONSTANTS.EMA_ALPHA;
          const newSmoothLat =
            smoothLatRef.current * (1 - alpha) + lat * alpha;
          const newSmoothLon =
            smoothLonRef.current * (1 - alpha) + lon * alpha;
          const newSpeed = speed ?? smoothSpeedRef.current;

          // Calculate distance using Haversine between smoothed positions
          const distDelta = haversineMeters(
            smoothLatRef.current,
            smoothLonRef.current,
            newSmoothLat,
            newSmoothLon,
          );

          // Minimum movement filter
          if (distDelta >= GPS_CONSTANTS.MIN_MOVEMENT_M) {
            totalDistRef.current += distDelta;
            setTotalDistanceM(totalDistRef.current);
          }

          smoothLatRef.current = newSmoothLat;
          smoothLonRef.current = newSmoothLon;
          smoothSpeedRef.current = newSpeed;
          lastGoodPointRef.current = { lat: newSmoothLat, lon: newSmoothLon };

          const newState: SmoothGpsState = {
            lat: newSmoothLat,
            lon: newSmoothLon,
            accuracy,
            speed: newSpeed,
            heading,
            timestamp,
            quality,
          };
          smoothStateRef.current = newState;
          setSmoothState(newState);

          // Лог только при значительных изменениях (>500м от последнего лога или смена качества)
          // Убираем каждосекундный лог 'Позиция обновлена', оставляем только ключевые события
        }
      } else if (quality === "degraded") {
        // Tier 2: Accept position cautiously, prefer Doppler speed
        if (isFirstFixRef.current) {
          smoothLatRef.current = lat;
          smoothLonRef.current = lon;
          smoothSpeedRef.current = speed ?? 0;
          isFirstFixRef.current = false;
          lastGoodPointRef.current = { lat, lon };

          const initState: SmoothGpsState = {
            lat,
            lon,
            accuracy,
            speed: speed ?? 0,
            heading,
            timestamp,
            quality,
          };
          smoothStateRef.current = initState;
          setSmoothState(initState);
        } else {
          const timeDelta = (timestamp - lastTimestampRef.current) / 1000;
          const newSpeed = speed ?? smoothSpeedRef.current;

          // Prefer Doppler speed for distance calculation
          const distBySpeed = newSpeed * timeDelta;

          smoothLatRef.current = lat;
          smoothLonRef.current = lon;
          smoothSpeedRef.current = newSpeed;
          lastGoodPointRef.current = { lat, lon };

          if (distBySpeed >= GPS_CONSTANTS.MIN_MOVEMENT_M) {
            totalDistRef.current += distBySpeed;
            setTotalDistanceM(totalDistRef.current);
          }

          const newState: SmoothGpsState = {
            lat,
            lon,
            accuracy,
            speed: newSpeed,
            heading,
            timestamp,
            quality,
          };
          smoothStateRef.current = newState;
          setSmoothState(newState);

          // Degraded — не логируем каждое обновление, только если quality изменился с good/dead_reck
        }
      } else if (quality === "poor") {
        // Tier 3: Ignore position, use Doppler speed only
        if (isFirstFixRef.current) {
          smoothSpeedRef.current = speed ?? 0;
          isFirstFixRef.current = false;
          lastGoodPointRef.current = { lat, lon };
          smoothLatRef.current = lat;
          smoothLonRef.current = lon;
        } else {
          const timeDelta = (timestamp - lastTimestampRef.current) / 1000;
          const newSpeed = speed ?? smoothSpeedRef.current;
          const distBySpeed = newSpeed * timeDelta;

          smoothSpeedRef.current = newSpeed;

          if (distBySpeed >= GPS_CONSTANTS.MIN_MOVEMENT_M) {
            totalDistRef.current += distBySpeed;
            setTotalDistanceM(totalDistRef.current);
          }

          const newState: SmoothGpsState = {
            lat: smoothLatRef.current,
            lon: smoothLonRef.current,
            accuracy,
            speed: newSpeed,
            heading,
            timestamp,
            quality: "poor",
          };
          smoothStateRef.current = newState;
          setSmoothState(newState);
        }
      }

      lastTimestampRef.current = timestamp;
    },
    [addEvent],
  );

  // WatchPosition handler
  const handlePosition = useCallback(
    (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy, speed, heading } = pos.coords;
      processPosition(
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        pos.timestamp,
        false,
      );
    },
    [processPosition],
  );

  const handleError = useCallback(
    (err: GeolocationPositionError) => {
      const msg = err.code === 1
        ? "GPS заблокирован: разрешите доступ к геолокации в настройках браузера"
        : err.code === 2
          ? "GPS недоступен: не удалось определить местоположение (попробуйте выйти на улицу)"
          : `GPS ошибка: ${err.message}`;
      addEvent("error", msg, { code: err.code });
      setLastError(msg);
    },
    [addEvent],
  );

  // Start watching GPS
  const startWatching = useCallback(() => {
    if (watchIdRef.current !== null) return;

    if (!navigator.geolocation) {
      addEvent("error", "Geolocation не поддерживается браузером");
      return;
    }

    // Запрашиваем разрешение на IMU (iOS требует явного согласия)
    const startImu = () => {
      if (imu.isSupported) {
        imu.startListening();
        addEvent("system", "IMU активирован (акселерометр + компас)");
      }
    };

    if (imu.isSupported && !imu.permissionGranted) {
      imu.requestPermission().then((granted) => {
        if (granted) {
          startImu();
          addEvent("system", "Разрешение IMU получено");
        } else {
          addEvent("warn", "IMU недоступен: разрешение не получено");
        }
      });
    } else if (imu.isSupported) {
      startImu();
    }

    // Мгновенный первый fix через getCurrentPosition (для отображения на карте сразу)
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      },
    );

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );

    watchIdRef.current = watchId;
    setIsWatching(true);
    addEvent("system", "GPS отслеживание запущено");
    startDRTimer();
  }, [handlePosition, handleError, addEvent, startDRTimer, imu]);

  // Stop watching GPS
  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Останавливаем IMU
    if (imu.isSupported) {
      imu.stopListening();
    }

    setIsWatching(false);
    stopDRTimer();
    addEvent("system", "GPS отслеживание остановлено");
  }, [addEvent, stopDRTimer, imu]);

  // Add simulated point (с поддержкой точности от сценария)
  // Всегда передаём isSim=true — accuracy определяет качество (10='sim', 999='dead_reck')
  const addSimulatedPoint = useCallback(
    (lat: number, lon: number, speed: number, accuracy?: number) => {
      const now = Date.now();
      const acc = accuracy ?? 10 + Math.random() * 10;
      processPosition(lat, lon, acc, speed, null, now, true);
    },
    [processPosition],
  );

  // Reset all GPS state refs for a clean start
  const resetGpsState = useCallback(() => {
    isFirstFixRef.current = true;
    smoothLatRef.current = 0;
    smoothLonRef.current = 0;
    smoothSpeedRef.current = 0;
    lastGoodPointRef.current = null;
    lastTimestampRef.current = 0;
    lastGpsTimeRef.current = Date.now();
    totalDistRef.current = 0;
    smoothStateRef.current = null;
    setSmoothState(null);
    setTotalDistanceM(0);
    setDeadReckoning({
      active: false,
      elapsedSinceLastGPS: 0,
      lastSpeed: 0,
      decayFactor: 1,
      estimatedLat: 0,
      estimatedLon: 0,
      heading: null,
      imuHeading: null,
      imuMoving: null,
      imuSupported: false,
    });
    setRecentPoints([]);
  }, []);

  // Set simulating
  const setSimulating = useCallback(
    (v: boolean) => {
      setIsSimulating(v);
      if (v) {
        resetGpsState();
        stopWatching();
        addEvent("system", "Симулятор GPS активирован");
      } else {
        addEvent("system", "Реальный GPS активирован");
        startWatching();
      }
    },
    [stopWatching, startWatching, addEvent, resetGpsState],
  );

  // Принудительная перезагрузка GPS (сброс watchIdRef + перезапуск)
  const retryWatching = useCallback(() => {
    // Принудительно сбрасываем watchIdRef, чтобы startWatching не заблокировался
    if (watchIdRef.current !== null) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
      watchIdRef.current = null;
    }
    setIsWatching(false);
    stopDRTimer();
    setLastError(null);
    // Небольшая задержка, чтобы state успел обновиться
    setTimeout(() => startWatching(), 100);
  }, [startWatching, stopDRTimer]);

  // Cleanup on unmount — ПОЛНЫЙ сброс watchPosition + DR timer
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        try {
          navigator.geolocation.clearWatch(watchIdRef.current);
        } catch {}
        watchIdRef.current = null;
      }
      stopDRTimer();
    };
  }, [stopDRTimer]);

  return {
    smoothState,
    deadReckoning,
    recentPoints,
    isWatching,
    startWatching,
    stopWatching,
    retryWatching,
    addSimulatedPoint,
    events,
    addEvent,
    clearEvents,
    totalDistanceM,
    isSimulating,
    setSimulating,
    imuSupported: imu.isSupported,
    imuActive: imu.snapshot !== null && imu.isSupported,
    imuPermissionGranted: imu.permissionGranted,
    lastError,
  };
}
