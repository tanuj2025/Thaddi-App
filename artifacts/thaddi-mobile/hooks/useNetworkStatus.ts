import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

type NetworkState = "checking" | "online" | "offline";

function healthcheckUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_DOMAIN;
  const base = configured
    ? configured.startsWith("http://") || configured.startsWith("https://")
      ? configured
      : `https://${configured}`
    : "https://thaddi.app";

  return `${base.replace(/\/+$/, "").replace(/\/api$/, "")}/api/healthz`;
}

/**
 * Cross-platform network status hook for iOS, Android, and Web.
 * Automatically notifies TanStack Query's onlineManager when connectivity changes.
 */
export function useNetworkStatus(): {
  isOnline: boolean;
  isOffline: boolean;
  isChecking: boolean;
  checkConnection: () => Promise<boolean>;
} {
  const [networkState, setNetworkState] = useState<NetworkState>("checking");

  const checkConnection = async (): Promise<boolean> => {
    // On Web, use navigator.onLine as primary indicator
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      if (!navigator.onLine) {
        setNetworkState("offline");
        onlineManager.setOnline(false);
        return false;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
      // Check the app's own health endpoint instead of a third-party HEAD
      // request. Some Android networks block HEAD/1.1.1.1 even when the app
      // server is reachable, which incorrectly forced the app into offline
      // mode.
      const res = await fetch(healthcheckUrl(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      const online = res !== null && (res.status >= 200 && res.status < 400);
      setNetworkState(online ? "online" : "offline");
      onlineManager.setOnline(online);
      return online;
    } catch {
      setNetworkState("offline");
      onlineManager.setOnline(false);
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    // Initial check on mount
    void checkConnection();

    // Browser online/offline event listeners for Web / Expo Web
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleOnline = () => void checkConnection();
      const handleOffline = () => {
        setNetworkState("offline");
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
    isOnline: networkState === "online",
    isOffline: networkState === "offline",
    isChecking: networkState === "checking",
    checkConnection,
  };
}
