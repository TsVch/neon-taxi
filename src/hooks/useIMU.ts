// ============================================================================
// IMU Hook — акселерометр + компас (iOS + Android)
// ============================================================================

import { useState, useRef, useCallback, useEffect } from "react";
import type { IMUSnapshot } from "@/types/taximeter";

export interface UseIMUReturn {
  snapshot: IMUSnapshot | null;
  isSupported: boolean;
  permissionGranted: boolean;
  requestPermission: () => Promise<boolean>;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * iOS 13+ требует явного разрешения пользователя для DeviceOrientationEvent.
 */
async function requestIosPermission(): Promise<boolean> {
  // DeviceOrientationEvent.requestPermission() существует только на iOS 13+
  const permissable = (DeviceOrientationEvent as unknown) as {
    requestPermission?: () => Promise<PermissionState>;
  };
  if (typeof permissable.requestPermission !== "function") {
    return true; // Не iOS — разрешение не требуется
  }
  try {
    const state = await permissable.requestPermission();
    return state === "granted";
  } catch {
    return false;
  }
}

export function useIMU(): UseIMUReturn {
  const [snapshot, setSnapshot] = useState<IMUSnapshot | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
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
        accelerationMagnitude: totalAccel,
      });
    },
    [],
  );

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await requestIosPermission();
    setPermissionGranted(granted);
    return granted;
  }, []);

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
    permissionGranted,
    requestPermission,
    startListening,
    stopListening,
  };
}
