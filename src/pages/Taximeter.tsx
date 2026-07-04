// ============================================================================
// Taximeter — Главная страница приложения GPS-таксометра
// ============================================================================

import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { useGPS } from "@/hooks/useGPS";
import { useSimulator } from "@/hooks/useSimulator";
import type {
  TariffId,
  TariffConfig,
  PlannedRoute,
  GeocodedPlace,
  KtodCoefficients,
  TripData,
  SnapResult,
} from "@/types/taximeter";
import { TARIFFS, DEFAULT_KTOD, GPS_CONSTANTS } from "@/types/taximeter";
import { computeKtod } from "@/utils/ktod";
import { snapToRoute, shouldRecalculateRoute } from "@/utils/routeSnap";
import { getRoute } from "@/utils/routing";
import { haversineMeters } from "@/utils/haversine";
import { TEST_SCENARIO, scenarioToPlannedRoute } from "@/utils/testScenario";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const TripMap = lazy(() => import("@/components/TripMap"));
const RoutePanel = lazy(() => import("@/components/RoutePanel"));
const TariffSelector = lazy(() => import("@/components/TariffSelector"));
const KtodTable = lazy(() => import("@/components/KtodTable"));
const EventLog = lazy(() => import("@/components/EventLog"));
const ReceiptModal = lazy(() => import("@/components/ReceiptModal"));

import {
  Play,
  Square,
  RotateCcw,
  Satellite,
  Cpu,
  Navigation,
  Timer,
  Route,
  Gauge,
  DollarSign,
  MapPin,
  Wifi,
  WifiOff,
  Battery,
  BatteryCharging,
} from "lucide-react";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function Taximeter() {
  // GPS Engine
  const {
    smoothState,
    deadReckoning,
    isWatching,
    startWatching,
    stopWatching,
    addSimulatedPoint,
    events,
    addEvent,
    clearEvents,
    totalDistanceM,
    isSimulating,
    setSimulating,
  } = useGPS();

  // Simulator
  const sim = useSimulator();
  const [showScenarioPicker, setShowScenarioPicker] = useState(false);

  // State
  const [status, setStatus] = useState<"ready" | "in_progress" | "completed">("ready");
  const [selectedTariff, setSelectedTariff] = useState<TariffId>("economy");
  const [customTariffs, setCustomTariffs] = useState<Partial<Record<TariffId, Partial<TariffConfig>>>>({});
  const [ktodCoeffs, setKtodCoeffs] = useState<KtodCoefficients>(DEFAULT_KTOD);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [fromPlace, setFromPlace] = useState<GeocodedPlace | null>(null);
  const [toPlace, setToPlace] = useState<GeocodedPlace | null>(null);
  const [fromCoords, setFromCoords] = useState<[number, number] | null>(null);
  const [toCoords, setToCoords] = useState<[number, number] | null>(null);
  const [gpsTrack, setGpsTrack] = useState<Array<[number, number]>>([]);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const [tripStartTime, setTripStartTime] = useState<number>(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [currentCost, setCurrentCost] = useState(0);
  const [completedTrip, setCompletedTrip] = useState<TripData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [routeDeviatedSince, setRouteDeviatedSince] = useState<number | null>(null);
  const [simSpeed, setSimSpeed] = useState(40);
  const [arrivalModalOpen, setArrivalModalOpen] = useState(false);
  const [lastArrivalReminder, setLastArrivalReminder] = useState(0);

  // Refs
  const cursorMRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripDataRef = useRef<{
    startTime: number;
    distanceM: number;
  }>({ startTime: 0, distanceM: 0 });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Screen Wake Lock — предотвращает затухание экрана во время поездки
  const requestWakeLock = useCallback(async () => {
    try {
      if (!navigator.wakeLock) {
        addEvent("system", "Wake Lock API не поддерживается браузером");
        return;
      }
      // Освобождаем предыдущий блокировщик, если есть
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      addEvent("system", "Экран заблокирован от затухания");

      // Автоматическое восстановление блокировки, если ОС её сняла
      sentinel.addEventListener("release", () => {
        // Если поездка всё ещё активна — запрашиваем повторно
        if (statusRef.current === "in_progress") {
          addEvent("warn", "Блокировка экрана снята системой — восстанавливаем...");
          navigator.wakeLock.request("screen").then((newSentinel) => {
            wakeLockRef.current = newSentinel;
            addEvent("system", "Блокировка экрана восстановлена");
            // Снова подписываемся на освобождение
            newSentinel.addEventListener("release", () => {
              if (statusRef.current === "in_progress") {
                requestWakeLock();
              }
            });
          }).catch(() => {
            addEvent("warn", "Не удалось восстановить блокировку экрана");
          });
        }
      });
    } catch (err) {
      addEvent("warn", `Wake Lock не удался: ${(err as Error).message}`);
    }
  }, [addEvent]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        addEvent("system", "Блокировка экрана снята");
      } catch {
        // игнорируем ошибки освобождения
      }
      wakeLockRef.current = null;
    }
  }, [addEvent]);

  // Реф для статуса, чтобы Wake Lock колбэк имел доступ к актуальному статусу
  const statusRef = useRef<typeof status>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Освобождаем блокировку при размонтировании
  useEffect(() => {
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  // Pull-to-refresh уже предотвращён через CSS: overscroll-behavior: none + body { overflow: hidden; position: fixed }
  // Ничего дополнительно делать не нужно

  // Current Ktod
  const currentKtod = computeKtod(new Date(), ktodCoeffs);
  const currentTariff: TariffConfig = {
    ...TARIFFS[selectedTariff],
    ...customTariffs[selectedTariff],
  };

  // Calculate cost
  const calculateCost = useCallback(
    (distanceM: number, durationSec: number) => {
      const distanceKm = distanceM / 1000;
      const durationMin = durationSec / 60;
      return (
        currentTariff.S +
        distanceKm * currentTariff.rd +
        durationMin * currentTariff.rt * currentKtod
      );
    },
    [currentTariff, currentKtod],
  );

  // Timer for updating duration and cost during trip
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - tripDataRef.current.startTime) / 1000;
      setCurrentDuration(elapsed);
      setCurrentCost(
        calculateCost(tripDataRef.current.distanceM, elapsed),
      );
    }, 1000);
  }, [calculateCost]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Process GPS point for metrics (during trip)
  useEffect(() => {
    if (status !== "in_progress" || !smoothState) return;

    // Update GPS track
    setGpsTrack((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return [[smoothState.lat, smoothState.lon]];
      const dist = haversineMeters(
        last[0],
        last[1],
        smoothState.lat,
        smoothState.lon,
      );
      if (dist < GPS_CONSTANTS.MIN_MOVEMENT_M) return prev;
      return [...prev.slice(-999), [smoothState.lat, smoothState.lon]];
    });

    // Route snapping
    if (route) {
      const maxAdvance =
        smoothState.speed * 1.5; // rate limit
      const result = snapToRoute(
        smoothState.lat,
        smoothState.lon,
        route,
        cursorMRef.current,
        maxAdvance,
      );
      setSnapResult(result);
      cursorMRef.current = result.cursorM;

      // Check for route deviation
      if (result.deviation > GPS_CONSTANTS.ROUTE_DEVIATION_THRESHOLD_M) {
        if (!routeDeviatedSince) {
          setRouteDeviatedSince(Date.now());
        } else if (
          smoothState.quality === "good" &&
          toCoords &&
          shouldRecalculateRoute(result.deviation, Date.now() - routeDeviatedSince)
        ) {
          // Auto-recalculate route
          addEvent("system", "Автоматическая перестройка маршрута...");
          getRoute(
            { lat: smoothState.lat, lon: smoothState.lon },
            { lat: toCoords[0], lon: toCoords[1] },
          ).then((newRoute) => {
            if (newRoute) {
              setRoute(newRoute);
              cursorMRef.current = 0;
              setRouteDeviatedSince(null);
              addEvent("system", "Маршрут перестроен");
            }
          });
        }
      } else {
        setRouteDeviatedSince(null);
      }

      // Arrival detection
      const progress = result.cursorM / route.totalDistanceM;
      if (progress >= GPS_CONSTANTS.ARRIVAL_THRESHOLD) {
        const now = Date.now();
        if (now - lastArrivalReminder > GPS_CONSTANTS.REMINDER_INTERVAL_MS) {
          setArrivalModalOpen(true);
          setLastArrivalReminder(now);
        }
      }
    }

    // Update trip distance
    tripDataRef.current.distanceM = totalDistanceM;
  }, [smoothState, status, route, totalDistanceM, toCoords, routeDeviatedSince, addEvent, lastArrivalReminder]);

  // Handle route built
  const handleRouteReady = useCallback(
    (newRoute: PlannedRoute, from: GeocodedPlace, to: GeocodedPlace) => {
      setRoute(newRoute);
      setFromPlace(from);
      setToPlace(to);
      cursorMRef.current = 0;
      setSnapResult(null);
      setGpsTrack([]);
      setRouteDeviatedSince(null);
      addEvent("system", `Маршрут построен: ${(newRoute.totalDistanceM / 1000).toFixed(1)} км`);
    },
    [addEvent],
  );

  // Start trip
  const handleStartTrip = useCallback(() => {
    const now = Date.now();
    const isScenarioMode = sim.isScenarioMode && sim.scenario;

    // Запрашиваем блокировку экрана
    requestWakeLock();

    // Start GPS if not already
    if (!isWatching && !isSimulating) {
      startWatching();
    }

    // Start simulator if in sim mode
    if (isSimulating) {
      sim.start(addSimulatedPoint);
    }

    // В режиме сценария: авто-настройка маршрута для отображения на карте
    if (isScenarioMode && sim.scenario) {
      const planned = scenarioToPlannedRoute(sim.scenario.route);
      const routeCoords = planned.coords;
      if (routeCoords.length > 0) {
        const start = routeCoords[0];
        const end = routeCoords[routeCoords.length - 1];

        setRoute(planned);
        setFromCoords(start);
        setToCoords(end);
        setFromPlace({ lat: start[0], lon: start[1], displayName: sim.scenario.fromLabel });
        setToPlace({ lat: end[0], lon: end[1], displayName: sim.scenario.toLabel });
        addEvent("system", `Маршрут: ${sim.scenario.fromLabel} → ${sim.scenario.toLabel} (${(planned.totalDistanceM / 1000).toFixed(1)} км)`);
      }
    }

    setStatus("in_progress");
    setTripStartTime(now);
    tripDataRef.current = { startTime: now, distanceM: 0 };
    setCurrentDuration(0);
    setCurrentCost(calculateCost(0, 0));
    setGpsTrack([]);
    cursorMRef.current = 0;
    setSnapResult(null);
    setRouteDeviatedSince(null);
    startTimer();
    addEvent("system", `Поездка начата. Тариф: ${currentTariff.name}`);
  }, [isWatching, isSimulating, startWatching, sim, addSimulatedPoint, calculateCost, currentTariff.name, startTimer, addEvent]);

  // End trip
  const handleEndTrip = useCallback(() => {
    stopTimer();
    sim.stop();
    releaseWakeLock();

    const endTime = Date.now();
    const durationSec = (endTime - tripDataRef.current.startTime) / 1000;
    const totalCost = calculateCost(tripDataRef.current.distanceM, durationSec);

    const trip: TripData = {
      id: `trip-${Date.now()}`,
      startTime: tripDataRef.current.startTime,
      endTime,
      distanceM: tripDataRef.current.distanceM,
      totalCost,
      tariffId: selectedTariff,
      tariff: currentTariff,
      ktod: currentKtod,
      ktodCoeffs,
      fromAddress: fromPlace?.displayName || "—",
      toAddress: toPlace?.displayName || "—",
      fromCoords,
      toCoords,
      route,
      status: "completed",
    };

    setCompletedTrip(trip);
    setShowReceipt(true);
    setStatus("completed");
    addEvent("system", `Поездка завершена: ${totalCost.toFixed(0)}₽`);
  }, [stopTimer, sim, calculateCost, selectedTariff, currentTariff, currentKtod, ktodCoeffs, fromPlace, toPlace, fromCoords, toCoords, route, addEvent]);

  // Reset
  const handleReset = useCallback(() => {
    stopTimer();
    sim.stop();
    stopWatching();
    releaseWakeLock();
    setStatus("ready");
    setRoute(null);
    setFromPlace(null);
    setToPlace(null);
    setFromCoords(null);
    setToCoords(null);
    setGpsTrack([]);
    setSnapResult(null);
    setTripStartTime(0);
    setCurrentDuration(0);
    setCurrentCost(0);
    setCompletedTrip(null);
    cursorMRef.current = 0;
    setRouteDeviatedSince(null);
    setArrivalModalOpen(false);
    addEvent("system", "Сброс поездки");
  }, [stopTimer, sim, stopWatching, addEvent]);

  // Toggle simulation
  const toggleSimulation = useCallback(
    (v: boolean) => {
      setSimulating(v);
      if (v) {
        sim.stop();
        addEvent("system", "Симулятор готов");
      } else {
        sim.stop();
        addEvent("system", "Режим реального GPS");
      }
    },
    [setSimulating, sim, addEvent],
  );

  // Clenup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
    };
  }, [stopTimer]);

  // Estmated values for price calculation
  const estimatedDistanceKm = route ? route.totalDistanceM / 1000 : 5;
  const estimatedDurationMin = route ? route.totalDurationS / 60 : 15;

  // GPS status
  const gpsQuality = smoothState?.quality || null;
  const gpsSpeedKmh = smoothState ? smoothState.speed * 3.6 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-black/60 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Navigation className="h-5 w-5 text-cyan-400" />
              <span className="font-bold text-base bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Neon Taxi
              </span>
            </div>
            <Badge
              variant="outline"
              className={`
                text-[10px] px-2 py-0 border
                ${status === "ready" ? "border-green-500/50 text-green-400 bg-green-500/10" : ""}
                ${status === "in_progress" ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/10 animate-pulse" : ""}
                ${status === "completed" ? "border-purple-500/50 text-purple-400 bg-purple-500/10" : ""}
              `}
            >
              {status === "ready" ? "ГОТОВ" : status === "in_progress" ? "В ПОЕЗДКЕ" : "ЗАВЕРШЕНО"}
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            {/* Simulation toggle */}
            <div className="flex items-center gap-2">
              <Satellite className={`h-3.5 w-3.5 ${isSimulating ? "text-orange-400" : "text-cyan-400"}`} />
              <Switch
                checked={isSimulating}
                onCheckedChange={toggleSimulation}
                className="data-[state=checked]:bg-orange-500"
              />
              <Cpu className={`h-3.5 w-3.5 ${isSimulating ? "text-orange-400" : "text-white/20"}`} />
            </div>

            {/* Sim speed control */}
            {isSimulating && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSimSpeed(Math.max(10, simSpeed - 10))}
                  className="text-[10px] text-white/30 hover:text-white/60 px-1"
                >
                  -
                </button>
                <span className="text-[10px] text-orange-400 font-mono min-w-[40px] text-center">
                  {simSpeed}км/ч
                </span>
                <button
                  onClick={() => setSimSpeed(Math.min(120, simSpeed + 10))}
                  className="text-[10px] text-white/30 hover:text-white/60 px-1"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Scenario Picker Modal */}
      {showScenarioPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowScenarioPicker(false)}>
          <div
            className="bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl p-6 max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-2">🧪 Тестовый сценарий</h3>
            <p className="text-sm text-white/50 mb-4">
              Запустить полную имитацию поездки с пропажей GPS, отклонением от
              маршрута и остановками. После запуска нажмите «Начать поездку».
            </p>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 mb-4">
              <div className="text-sm font-semibold text-cyan-400 mb-1">
                {TEST_SCENARIO.name}
              </div>
              <div className="text-xs text-white/40 leading-relaxed">
                {TEST_SCENARIO.description}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-[10px] px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  🛰 GPS норм
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/30">
                  ⛔ GPS loss
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/30">
                  🚗 Отклонение
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
                  ✋ Остановка
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-white/10 text-white/60"
                onClick={() => {
                  sim.setScenario(null);
                  setShowScenarioPicker(false);
                  addEvent("system", "Сценарий отключён, стандартный симулятор");
                }}
              >
                Отмена
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                onClick={() => {
                  sim.setScenario(TEST_SCENARIO);
                  setShowScenarioPicker(false);
                  addEvent(
                    "system",
                    `Сценарий активирован: ${TEST_SCENARIO.name}, ` +
                      `${(TEST_SCENARIO.route.length / 10).toFixed(0)} точек`,
                  );
                }}
              >
                Запустить сценарий
              </Button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel — controls */}
          <div className="space-y-4 lg:col-span-1">
            {/* GPS Status */}
            <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {gpsQuality && gpsQuality !== "dead_reck" ? (
                    <Wifi className="h-4 w-4 text-green-400" />
                  ) : gpsQuality === "dead_reck" ? (
                    <Wifi className="h-4 w-4 text-orange-400 animate-pulse" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-white/20" />
                  )}
                  <span className="text-xs font-medium text-white/60 uppercase tracking-wider">
                    GPS
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={`
                    text-[10px] px-2 py-0
                    ${gpsQuality === "good" || gpsQuality === "sim" ? "border-green-500/30 text-green-400" : ""}
                    ${gpsQuality === "degraded" ? "border-yellow-500/30 text-yellow-400" : ""}
                    ${gpsQuality === "poor" ? "border-orange-500/30 text-orange-400" : ""}
                    ${gpsQuality === "dead_reck" ? "border-red-500/30 text-red-400" : ""}
                    ${!gpsQuality ? "border-white/10 text-white/30" : ""}
                  `}
                >
                  {gpsQuality === "good" ? "Хороший" :
                   gpsQuality === "degraded" ? "Средний" :
                   gpsQuality === "poor" ? "Плохой" :
                   gpsQuality === "dead_reck" ? "DR" :
                   gpsQuality === "sim" ? "SIM" :
                   "Нет сигнала"}
                </Badge>
              </div>
              {gpsQuality && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">Скорость</p>
                    <p className="text-sm font-bold font-mono text-cyan-400">
                      {gpsSpeedKmh.toFixed(0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">Точность</p>
                    <p className="text-sm font-bold font-mono text-white/60">
                      {smoothState?.accuracy.toFixed(0) || "—"}м
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase">DR</p>
                    <p className="text-sm font-bold font-mono text-orange-400">
                      {deadReckoning.active ? "Активен" : "—"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Route Panel */}
            <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm p-4">
              <Suspense fallback={<div className="text-xs text-white/30">Loading...</div>}>
                <RoutePanel
                  onRouteReady={handleRouteReady}
                  onFromCoords={setFromCoords}
                  onToCoords={setToCoords}
                  isInTrip={status === "in_progress"}
                />
              </Suspense>
            </div>

            {/* Scenario selector */}
            {isSimulating && status === "ready" && (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
                    Тестовый сценарий
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 ${
                      sim.isScenarioMode
                        ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/10"
                        : "border-white/10 text-white/30"
                    }`}
                  >
                    {sim.isScenarioMode ? "Активен" : "Выкл"}
                  </Badge>
                </div>
                <p className="text-[10px] text-white/30 mb-3 leading-relaxed">
                  {sim.isScenarioMode && sim.scenario
                    ? `${sim.scenario.description}. Нажмите «Начать поездку»`
                    : "Включите для имитации длительной поездки с нештатными ситуациями"}
                </p>
                <div className="flex gap-2">
                  {!sim.isScenarioMode ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px] h-8 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                      onClick={() => setShowScenarioPicker(true)}
                    >
                      Выбрать сценарий
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px] h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        sim.setScenario(null);
                        addEvent("system", "Сценарий отключён");
                      }}
                    >
                      Отключить сценарий
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Tariff Selector */}
            <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm p-4">
              <Suspense fallback={<div className="text-xs text-white/30">Loading...</div>}>
                <TariffSelector
                  selectedTariff={selectedTariff}
                  onSelect={setSelectedTariff}
                  customTariffs={customTariffs}
                  onCustomize={(id, updates) =>
                    setCustomTariffs((prev) => ({
                      ...prev,
                      [id]: { ...prev[id], ...updates },
                    }))
                  }
                  ktodCoeffs={ktodCoeffs}
                  estimatedDistanceKm={estimatedDistanceKm}
                  estimatedDurationMin={estimatedDurationMin}
                />
              </Suspense>
            </div>

            {/* Ktod Table */}
            <Suspense fallback={<div className="text-xs text-white/30">Loading...</div>}>
              <KtodTable
                coefficients={ktodCoeffs}
                onChange={setKtodCoeffs}
              />
            </Suspense>

            {/* Controls */}
            <div className="flex gap-2">
              {status === "ready" && (
                <Button
                  onClick={handleStartTrip}
                  className="flex-1 gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white shadow-lg shadow-green-500/20"
                >
                  <Play className="h-4 w-4" />
                  Начать поездку
                </Button>
              )}

              {status === "in_progress" && (
                <Button
                  onClick={handleEndTrip}
                  className="flex-1 gap-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white shadow-lg shadow-red-500/20 animate-pulse"
                >
                  <Square className="h-4 w-4" />
                  Завершить
                </Button>
              )}

              {status === "completed" && (
                <Button
                  onClick={handleReset}
                  className="flex-1 gap-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 text-white shadow-lg shadow-blue-500/20"
                >
                  <RotateCcw className="h-4 w-4" />
                  Новая поездка
                </Button>
              )}
            </div>
          </div>

          {/* Center panel — map + counters */}
          <div className="space-y-4 lg:col-span-2">
            {/* Main Counters */}
            <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm p-6">
              <div className="text-center">
                {/* Cost — large */}
                <div className="text-6xl font-bold bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent animate-pulse-slow">
                  {status === "in_progress" ? `${Math.round(currentCost)}₽` : status === "completed" && completedTrip ? `${Math.round(completedTrip.totalCost)}₽` : "0₽"}
                </div>
                <p className="text-xs text-white/30 mt-1">
                  {currentTariff.name} · S={currentTariff.S} · rd={currentTariff.rd} · rt={currentTariff.rt} · Ktod=×{currentKtod.toFixed(1)}
                </p>
              </div>

              {/* Secondary counters */}
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Timer className="h-3 w-3 text-purple-400" />
                    <span className="text-[9px] text-white/30 uppercase tracking-wider">Время</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-purple-400">
                    {status === "in_progress"
                      ? formatDuration(currentDuration)
                      : status === "completed" && completedTrip
                        ? formatDuration((completedTrip.endTime! - completedTrip.startTime) / 1000)
                        : "00:00:00"}
                  </p>
                </div>

                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Route className="h-3 w-3 text-green-400" />
                    <span className="text-[9px] text-white/30 uppercase tracking-wider">Расстояние</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-green-400">
                    {(totalDistanceM / 1000).toFixed(2)}
                    <span className="text-sm text-green-400/60 ml-1">км</span>
                  </p>
                </div>

                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Gauge className="h-3 w-3 text-orange-400" />
                    <span className="text-[9px] text-white/30 uppercase tracking-wider">Скорость</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-orange-400">
                    {gpsSpeedKmh.toFixed(0)}
                    <span className="text-sm text-orange-400/60 ml-1">км/ч</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Route Progress Bar */}
            {route && snapResult && status === "in_progress" && (
              <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">
                    Прогресс маршрута
                  </span>
                  <span className="text-xs font-mono text-cyan-400">
                    {(snapResult.cursorM / 1000).toFixed(1)} / {(route.totalDistanceM / 1000).toFixed(1)} км
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (snapResult.cursorM / route.totalDistanceM) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-white/20">
                    откл. {(snapResult.deviation).toFixed(0)}м
                  </span>
                  <span className="text-[9px] text-white/20">
                    ост. {((route.totalDistanceM - snapResult.cursorM) / 1000).toFixed(1)} км
                  </span>
                </div>
              </div>
            )}

            {/* Map */}
            <Suspense fallback={
              <div className="h-[400px] rounded-xl border border-white/10 bg-black/40 flex items-center justify-center">
                <div className="text-xs text-white/30 animate-pulse">Загрузка карты...</div>
              </div>
            }>
              <TripMap
                route={route}
                smoothState={smoothState}
                snapResult={snapResult}
                gpsTrack={gpsTrack}
                fromCoords={fromCoords}
                toCoords={toCoords}
              />
            </Suspense>

            {/* Event Log */}
            <Suspense fallback={<div className="text-xs text-white/30">Loading...</div>}>
              <EventLog events={events} onClear={clearEvents} />
            </Suspense>
          </div>
        </div>
      </main>

      {/* Arrival Modal */}
      {arrivalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl p-8 max-w-sm mx-4 shadow-2xl text-center">
            <MapPin className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">
              Вы доехали до конечной точки
            </h2>
            <p className="text-sm text-white/50 mb-6">
              Завершить поездку?
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-white/10 text-white/60 hover:text-white hover:bg-white/5"
                onClick={() => setArrivalModalOpen(false)}
              >
                Нет, напомнить позже
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-400 hover:to-emerald-500"
                onClick={() => {
                  setArrivalModalOpen(false);
                  handleEndTrip();
                }}
              >
                Завершить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      <Suspense fallback={null}>
        <ReceiptModal
          trip={completedTrip}
          open={showReceipt}
          onOpenChange={setShowReceipt}
        />
      </Suspense>
    </div>
  );
}
