import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

/**
 * Cross-platform network status hook for iOS, Android, and Web.
 * Automatically notifies TanStack Query's onlineManager when connectivity changes.
 */
export function useNetworkStatus(): {
  isOnline: boolean;
  isOffline: boolean;
  checkConnection: () => Promise<boolean>;
} {
  const [isOnline, setIsOnline] = useState<boolean>(true);

  const checkConnection = async (): Promise<boolean> => {
    // On Web, use navigator.onLine as primary indicator
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      if (!navigator.onLine) {
        setIsOnline(false);
        onlineManager.setOnline(false);
        return false;
      }
    }

    try {
      // Fast lightweight ping (1.5s timeout) to verify actual internet reachability
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch("https://1.1.1.1/cdn-cgi/trace", {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      const online = res !== null && (res.status >= 200 && res.status < 400);
      setIsOnline(online);
      onlineManager.setOnline(online);
      return online;
    } catch {
      setIsOnline(false);
      onlineManager.setOnline(false);
      return false;
    }
  };

  useEffect(() => {
    // Initial check on mount
    void checkConnection();

    // Browser online/offline event listeners for Web / Expo Web
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleOnline = () => {
        setIsOnline(true);
        onlineManager.setOnline(true);
      };
      const handleOffline = () => {
        setIsOnline(false);
        onlineManager.setOnline(false);
      };

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    // AppState listener for native iOS / Android resume
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkConnection();
      }
    });

    // Periodic heartbeat check when offline to detect recovery
    const interval = setInterval(() => {
      void checkConnection();
    }, 10000);

    return () => {
      appStateSub.remove();
      clearInterval(interval);
    };
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
    checkConnection,
  };
}
