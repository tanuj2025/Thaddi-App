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

const PRIMARY_HEALTHCHECK_TIMEOUT_MS = 7000;
const FALLBACK_PING_TIMEOUT_MS = 3000;

async function pingUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => null);
    return res !== null && res.status >= 200 && res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
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
  // Optimistically assume online on startup so queries are not blocked before checking
  const [networkState, setNetworkState] = useState<NetworkState>("online");

  const checkConnection = async (): Promise<boolean> => {
    // On Web, use navigator.onLine as primary indicator
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      if (!navigator.onLine) {
        setNetworkState("offline");
        onlineManager.setOnline(false);
        return false;
      }
    }

    // 1. Primary check: app's own health endpoint with a generous 7s mobile timeout
    const primaryOk = await pingUrl(healthcheckUrl(), PRIMARY_HEALTHCHECK_TIMEOUT_MS);
    if (primaryOk) {
      setNetworkState("online");
      onlineManager.setOnline(true);
      return true;
    }

    // 2. Fallback check: if app server was slow/unreachable, verify general internet reachability
    // before locking the entire app in offline mode.
    const fallbackOk =
      (await pingUrl("https://clients3.google.com/generate_204", FALLBACK_PING_TIMEOUT_MS)) ||
      (await pingUrl("https://1.1.1.1/cdn-cgi/trace", FALLBACK_PING_TIMEOUT_MS));

    const isConnected = fallbackOk;
    setNetworkState(isConnected ? "online" : "offline");
    onlineManager.setOnline(isConnected);
    return isConnected;
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
