import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { translations, type Language } from "./translations";

const STORAGE_KEY = "thaddi_lang";

export type Dir = "rtl" | "ltr";

interface I18nContextType {
  lang: Language;
  dir: Dir;
  ready: boolean;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNum: (n: number) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Arabic-first: default to 'ar' before the stored preference resolves.
  const [lang, setLangState] = useState<Language>("ar");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && (saved === "ar" || saved === "en")) {
          setLangState(saved);
        }
      } catch {
        // Persisted preference is best-effort; fall back to the AR default.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next = prev === "ar" ? "en" : "ar";
      void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const dir: Dir = lang === "ar" ? "rtl" : "ltr";

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let str = translations[lang][key] ?? translations.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  const formatNum = useCallback((n: number): string => {
    // Western digits in both locales (matches the web surface).
    return n.toLocaleString("en-US");
  }, []);

  const value = useMemo<I18nContextType>(
    () => ({ lang, dir, ready, setLang, toggleLang, t, formatNum }),
    [lang, dir, ready, setLang, toggleLang, t, formatNum],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

/**
 * Direction-aware style helpers. We deliberately do NOT call
 * I18nManager.forceRTL (it requires a native reload and fights Expo Go); instead
 * every layout reads `dir` and mirrors itself.
 */
export function rowDirection(dir: Dir): "row" | "row-reverse" {
  return dir === "rtl" ? "row-reverse" : "row";
}

export function textAlign(dir: Dir): "left" | "right" {
  return dir === "rtl" ? "right" : "left";
}

/** writingDirection for <Text> so bidi runs render correctly. */
export function writingDirection(dir: Dir): Dir {
  return dir;
}

/** Mirror a horizontal chevron/arrow: in RTL "forward" points left. */
export function forwardChevron(dir: Dir): "chevron-left" | "chevron-right" {
  return dir === "rtl" ? "chevron-left" : "chevron-right";
}

export function backChevron(dir: Dir): "chevron-left" | "chevron-right" {
  return dir === "rtl" ? "chevron-right" : "chevron-left";
}

const LRI = "\u2066"; // LEFT-TO-RIGHT ISOLATE
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE

/**
 * Wrap a mixed digit+letter token (e.g. a countdown segment like "45د") in a
 * left-to-right isolate so the bidi algorithm keeps it in logical order instead
 * of scrambling the western digits against the adjacent Arabic unit letters.
 */
export function ltrIsolate(s: string): string {
  return `${LRI}${s}${PDI}`;
}
