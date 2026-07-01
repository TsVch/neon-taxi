// ============================================================================
// RoutePanel — Панель ввода адресов и построения маршрута
// ============================================================================

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Navigation,
  MapPin,
  ArrowRight,
  Loader2,
  Settings2,
} from "lucide-react";
import type { GeocodedPlace, PlannedRoute } from "@/types/taximeter";
import { geocodeAddress, getRoute } from "@/utils/routing";
import { cn } from "@/lib/utils";

interface RoutePanelProps {
  onRouteReady: (route: PlannedRoute, from: GeocodedPlace, to: GeocodedPlace) => void;
  onFromCoords: (coords: [number, number] | null) => void;
  onToCoords: (coords: [number, number] | null) => void;
  isInTrip: boolean;
}

export default function RoutePanel({
  onRouteReady,
  onFromCoords,
  onToCoords,
  isInTrip,
}: RoutePanelProps) {
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromPlace, setFromPlace] = useState<GeocodedPlace | null>(null);
  const [toPlace, setToPlace] = useState<GeocodedPlace | null>(null);

  const handleFromChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setFromAddress(val);
      if (!val) {
        setFromPlace(null);
        onFromCoords(null);
      }
    },
    [onFromCoords],
  );

  const handleToChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setToAddress(val);
      if (!val) {
        setToPlace(null);
        onToCoords(null);
      }
    },
    [onToCoords],
  );

  const handleGeocodeFrom = useCallback(async () => {
    if (!fromAddress.trim()) return;
    const result = await geocodeAddress(fromAddress.trim());
    if (result) {
      setFromPlace(result);
      onFromCoords([result.lat, result.lon]);
      setFromAddress(result.displayName.split(",")[0]);
    } else {
      setError("Не удалось найти адрес");
    }
  }, [fromAddress, onFromCoords]);

  const handleGeocodeTo = useCallback(async () => {
    if (!toAddress.trim()) return;
    const result = await geocodeAddress(toAddress.trim());
    if (result) {
      setToPlace(result);
      onToCoords([result.lat, result.lon]);
      setToAddress(result.displayName.split(",")[0]);
    } else {
      setError("Не удалось найти адрес");
    }
  }, [toAddress, onToCoords]);

  const handleBuildRoute = useCallback(async () => {
    if (!fromPlace || !toPlace) {
      setError("Сначала укажите оба адреса");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const route = await getRoute(
        { lat: fromPlace.lat, lon: fromPlace.lon },
        { lat: toPlace.lat, lon: toPlace.lon },
      );

      if (route) {
        onRouteReady(route, fromPlace, toPlace);
      } else {
        setError("Не удалось построить маршрут. Попробуйте другие адреса.");
      }
    } catch (err) {
      setError("Ошибка при построении маршрута");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [fromPlace, toPlace, onRouteReady]);

  const handleSwapAddresses = useCallback(() => {
    setFromAddress(toAddress);
    setToAddress(fromAddress);
    setFromPlace(toPlace);
    setToPlace(fromPlace);
    onFromCoords(toPlace ? [toPlace.lat, toPlace.lon] : null);
    onToCoords(fromPlace ? [fromPlace.lat, fromPlace.lon] : null);
  }, [toAddress, fromAddress, toPlace, fromPlace, onFromCoords, onToCoords]);

  return (
    <div className="space-y-3">
      {/* From address */}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-400" />
        <Input
          placeholder="Откуда?"
          value={fromAddress}
          onChange={handleFromChange}
          onBlur={handleGeocodeFrom}
          disabled={isInTrip || isLoading}
          className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
        />
        {fromPlace && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
          </div>
        )}
      </div>

      {/* Swap button */}
      <div className="flex justify-center -my-1 relative z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full bg-black/60 border border-white/10 hover:bg-white/10"
          onClick={handleSwapAddresses}
          disabled={isInTrip}
        >
          <ArrowRight className="h-3 w-3 text-white/60 rotate-90" />
        </Button>
      </div>

      {/* To address */}
      <div className="relative">
        <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-400" />
        <Input
          placeholder="Куда?"
          value={toAddress}
          onChange={handleToChange}
          onBlur={handleGeocodeTo}
          disabled={isInTrip || isLoading}
          className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
        />
        {toPlace && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-400 px-1">{error}</p>
      )}

      {/* Build route button */}
      <Button
        onClick={handleBuildRoute}
        disabled={
          isLoading ||
          !fromAddress.trim() ||
          !toAddress.trim() ||
          !fromPlace ||
          !toPlace ||
          isInTrip
        }
        className={cn(
          "w-full gap-2 transition-all duration-300",
          "bg-gradient-to-r from-blue-500 to-blue-600",
          "hover:from-blue-400 hover:to-blue-500",
          "text-white shadow-lg shadow-blue-500/20",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Построение маршрута...
          </>
        ) : (
          <>
            <Navigation className="h-4 w-4" />
            Построить маршрут
          </>
        )}
      </Button>
    </div>
  );
}
