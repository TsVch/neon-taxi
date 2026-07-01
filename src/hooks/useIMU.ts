// ============================================================================
// IMU Hook — акселерометр + компас
// ============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import type { IMUSnapshot } from "@/types/taximeter";

export interface UseIMUReturn {
  snapshot: IMUSnapshot | null;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function useIMU(): UseIMUReturn {
  const [snapshot, setSnapshot] = useState<IMUSnapshot | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const orientationRef = useRef<number | null>(null);
  const accelListenerRef = useRef<boolean>(false);

  useEffect(() => {
    const hasDeviceOrientation =
      "DeviceOrientationEvent" in window;
    const hasDeviceMotion = "DeviceMotionEvent" in window;

    setIsSupported(hasDeviceOrientation || hasDeviceMotion);
  }, []);

  const handleOrientation = useCallback(
    (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) {
        // alpha = compass heading (0-360)
        orientationRef.current = event.alpha;
      }
    },
    [],
  );

  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      if (!event.acceleration) return;

      const { x, y, z } = event.acceleration;
      const totalAccel = Math.sqrt(
        (x ?? 0) * (x ?? 0) +
          (y ?? 0) * (y ?? 0) +
          (z ?? 0) * (z ?? 0),
      );

      const isMoving = totalAccel > 0.4; // m/s² threshold

      setSnapshot({
        heading: orientationRef.current,
        isMoving,
      });
    },
    [],
  );

  const startListening = useCallback(() => {
    if (accelListenerRef.current) return;

    if ("DeviceOrientationEvent" in window) {
      window.addEventListener("deviceorientation", handleOrientation);
    }

    if ("DeviceMotionEvent" in window) {
      window.addEventListener("devicemotion", handleMotion);
    }

    accelListenerRef.current = true;
  }, [handleOrientation, handleMotion]);

  const stopListening = useCallback(() => {
    window.removeEventListener("deviceorientation", handleOrientation);
    window.removeEventListener("devicemotion", handleMotion);
    accelListenerRef.current = false;
  }, [handleOrientation, handleMotion]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    snapshot,
    isSupported,
    startListening,
    stopListening,
  };
}
