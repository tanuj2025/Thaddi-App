import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, Check, X, Loader2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";

type ZxcvbnFn = (password: string) => { score: number };

let zxcvbnPromise: Promise<ZxcvbnFn> | null = null;
function loadZxcvbn(): Promise<ZxcvbnFn> {
  if (!zxcvbnPromise) {
    zxcvbnPromise = import("zxcvbn").then(
      (m) => (m.default ?? m) as unknown as ZxcvbnFn,
    );
  }
  return zxcvbnPromise;
}

async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

type RuleState = "idle" | "pending" | "checking" | "met" | "fail";

function RuleRow({ state, label }: { state: RuleState; label: string }) {
  const { t } = useI18n();
  let icon: React.ReactNode;
  let textClass = "text-muted-foreground";
  let srStatus = t("auth.passwordHint.statusUnmet");

  if (state === "met") {
    icon = <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
    textClass = "text-foreground";
    srStatus = t("auth.passwordHint.statusMet");
  } else if (state === "fail") {
    icon = <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />;
    textClass = "text-destructive";
    srStatus = t("auth.passwordHint.statusUnmet");
  } else if (state === "checking") {
    icon = (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
    );
    srStatus = t("auth.passwordHint.checking");
  } else {
    icon = <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" aria-hidden="true" />;
  }

  return (
    <li className="flex items-start gap-2">
      {icon}
      <span className={textClass}>{label}</span>
      <span className="sr-only">{srStatus}</span>
    </li>
  );
}

export function PasswordRequirements({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [strengthOk, setStrengthOk] = useState<boolean | null>(null);
  const [breach, setBreach] = useState<"idle" | "checking" | "safe" | "breached">("idle");
  const liveRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target && target.tagName === "INPUT" && target.name === "password") {
        setPassword(target.value);
      }
    };
    root.addEventListener("input", handler, true);
    return () => root.removeEventListener("input", handler, true);
  }, [containerRef]);

  useEffect(() => {
    if (!password) {
      setStrengthOk(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const zxcvbn = await loadZxcvbn();
        if (cancelled) return;
        setStrengthOk(zxcvbn(password).score >= 2);
      } catch {
        if (!cancelled) setStrengthOk(null);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [password]);

  useEffect(() => {
    if (password.length < 8) {
      setBreach("idle");
      return;
    }
    let cancelled = false;
    setBreach("checking");
    const id = window.setTimeout(async () => {
      try {
        const hash = await sha1Hex(password);
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);
        const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { "Add-Padding": "true" },
        });
        if (!resp.ok) throw new Error();
        const body = await resp.text();
        if (cancelled) return;
        const found = body
          .split("\n")
          .some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
        setBreach(found ? "breached" : "safe");
      } catch {
        if (!cancelled) setBreach("idle");
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [password]);

  const hasInput = password.length > 0;

  const lengthState: RuleState = !hasInput
    ? "idle"
    : password.length >= 8
      ? "met"
      : "pending";

  const strengthState: RuleState = !hasInput
    ? "idle"
    : strengthOk === true
      ? "met"
      : "pending";

  const breachState: RuleState = !hasInput
    ? "idle"
    : password.length < 8
      ? "pending"
      : breach === "checking"
        ? "checking"
        : breach === "safe"
          ? "met"
          : breach === "breached"
            ? "fail"
            : "pending";

  return (
    <div className="card-premium rounded-2xl px-5 py-4 text-start">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">
          {t("auth.passwordHint.title")}
        </span>
      </div>
      <ul ref={liveRef} className="mt-2 space-y-1.5 text-sm" aria-live="polite">
        <RuleRow state={lengthState} label={t("auth.passwordHint.minLength")} />
        <RuleRow state={strengthState} label={t("auth.passwordHint.strong")} />
        <RuleRow state={breachState} label={t("auth.passwordHint.notBreached")} />
      </ul>
    </div>
  );
}
