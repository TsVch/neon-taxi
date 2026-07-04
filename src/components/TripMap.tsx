// ============================================================================
// TripMap — Leaflet карта с маршрутом, треком и легендой
// ============================================================================

import { useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { PlannedRoute, SmoothGpsState, SnapResult } from "@/types/taximeter";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Создание кастомных SVG иконок для карты
function createSvgIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      width: 24px; height: 24px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      color: white;
    ">${label}</div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

interface TripMapProps {
  route: PlannedRoute | null;
  smoothState: SmoothGpsState | null;
  snapResult: SnapResult | null;
  gpsTrack: Array<[number, number]>;
  fromCoords: [number, number] | null;
  toCoords: [number, number] | null;
}

// Remove "Leaflet" prefix from the attribution control
function AttributionCleaner() {
  const map = useMap();

  useEffect(() => {
    // Remove the default "Leaflet" prefix text from attribution control
    map.attributionControl?.setPrefix(false);
  }, [map]);

  return null;
}

// Auto-fit map to show all markers
function MapBoundsUpdater({ route, fromCoords, toCoords }: { route: PlannedRoute | null; fromCoords: [number, number] | null; toCoords: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([]);

    if (route && route.coords.length > 0) {
      route.coords.forEach((c) => bounds.extend(c));
    }
    if (fromCoords) bounds.extend(fromCoords);
    if (toCoords) bounds.extend(toCoords);

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [map, route, fromCoords, toCoords]);

  return null;
}

// Current position marker with pulse animation
function CurrentPositionMarker({ lat, lon, isDeadReckoning }: { lat: number; lon: number; isDeadReckoning: boolean }) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon]);
    }
  }, [lat, lon]);

  const color = isDeadReckoning ? "#a855f7" : "#f97316";
  const pulseColor = isDeadReckoning ? "rgba(168, 85, 247, 0.4)" : "rgba(249, 115, 22, 0.4)";

  const icon = L.divIcon({
    html: `
      <div style="position:relative;width:20px;height:20px">
        <div style="
          position:absolute;inset:-6px;
          border-radius:50%;
          background:${pulseColor};
          animation:pulse 2s infinite;
        "></div>
        <div style="
          width:20px;height:20px;
          background:${color};
          border:3px solid white;
          border-radius:50%;
          box-shadow:0 2px 8px rgba(0,0,0,0.5);
          position:absolute;
        "></div>
      </div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  return <Marker ref={markerRef} position={[lat, lon]} icon={icon} />;
}

// Snapped position marker
function SnappedPositionMarker({ lat, lon }: { lat: number; lon: number }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        html: `<div style="
          width: 14px; height: 14px;
          background: #a855f7;
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 12px rgba(168,85,247,0.6);
        "></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  );

  return <Marker position={[lat, lon]} icon={icon} />;
}

export default function TripMap({
  route,
  smoothState,
  snapResult,
  gpsTrack,
  fromCoords,
  toCoords,
}: TripMapProps) {
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg relative">
      {/* Map Legend */}
      <div className="absolute top-3 left-3 z-[1000] bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs space-y-1.5 border border-white/10 shadow-lg">
        <div className="text-white/80 font-semibold mb-1 text-[11px] uppercase tracking-wider">Легенда</div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-0.5 rounded bg-blue-400 inline-block" />
          <span className="text-white/70">Маршрут</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-0.5 rounded bg-green-400 inline-block" />
          <span className="text-white/70">GPS трек</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-orange-400 inline-block border border-white/50" />
          <span className="text-white/70">Текущая GPS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-purple-500 inline-block border border-white/50" />
          <span className="text-white/70">На маршруте</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
          <span className="text-white/70">Старт</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          <span className="text-white/70">Финиш</span>
        </div>
      </div>

      <MapContainer
        center={[55.7558, 37.6173]}
        zoom={12}
        className="h-[400px] w-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <AttributionCleaner />
        <MapBoundsUpdater route={route} fromCoords={fromCoords} toCoords={toCoords} />

        {/* Planned Route — синяя линия */}
        {route && route.coords.length > 1 && (
          <Polyline
            positions={route.coords}
            pathOptions={{
              color: "#60a5fa",
              weight: 4,
              opacity: 0.8,
              dashArray: "10, 6",
            }}
          />
        )}

        {/* GPS Track — зеленая линия */}
        {gpsTrack.length > 1 && (
          <Polyline
            positions={gpsTrack}
            pathOptions={{
              color: "#4ade80",
              weight: 3,
              opacity: 0.7,
            }}
          />
        )}

        {/* Start marker */}
        {fromCoords && (
          <Marker position={fromCoords} icon={createSvgIcon("#22c55e", "A")}>
            <Popup>Начало маршрута</Popup>
          </Marker>
        )}

        {/* End marker */}
        {toCoords && (
          <Marker position={toCoords} icon={createSvgIcon("#ef4444", "B")}>
            <Popup>Конечная точка</Popup>
          </Marker>
        )}

        {/* Current GPS position — оранжевая точка с пульсацией */}
        {smoothState && (
          <CurrentPositionMarker
            lat={smoothState.lat}
            lon={smoothState.lon}
            isDeadReckoning={smoothState.quality === "dead_reck"}
          />
        )}

        {/* Snapped position — фиолетовая точка */}
        {snapResult && (
          <SnappedPositionMarker
            lat={snapResult.snappedLat}
            lon={snapResult.snappedLon}
          />
        )}
      </MapContainer>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.5); opacity: 0.2; }
        }
        .leaflet-container {
          background: #0a0a1a;
        }
        .leaflet-control-zoom a {
          background: rgba(0,0,0,0.7) !important;
          color: white !important;
          border-color: rgba(255,255,255,0.1) !important;
        }
      `}</style>
    </div>
  );
}
