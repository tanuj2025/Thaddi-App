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

type FailKind = "length" | "strength" | "breach" | "generic";

function classifyPasswordError(key: string, text: string): FailKind | null {
  const k = key.toLowerCase();
  const x = text.toLowerCase();
  if (k.includes("pwned") || x.includes("data breach") || x.includes("breach") || x.includes("تسريب")) {
    return "breach";
  }
  if (
    k.includes("not_strong_enough") ||
    k.includes("strength") ||
    x.includes("not strong enough") ||
    x.includes("too weak") ||
    x.includes("ضعيف") ||
    x.includes("التخمين")
  ) {
    return "strength";
  }
  if (
    k.includes("too_short") ||
    k.includes("length") ||
    x.includes("8 characters") ||
    x.includes("characters or more") ||
    x.includes("٨ أحرف") ||
    x.includes("8 أحرف")
  ) {
    return "length";
  }
  if (k.includes("password") || x.includes("password") || x.includes("كلمة المرور")) {
    return "generic";
  }
  return null;
}

function detectPasswordError(root: HTMLElement): FailKind | null {
  const nodes = root.querySelectorAll<HTMLElement>(
    '.cl-formFieldErrorText__password, [data-localization-key^="unstable__errors.form_password"]',
  );
  for (const el of nodes) {
    const key = el.getAttribute("data-localization-key") ?? "";
    const text = el.textContent ?? "";
    const kind = classifyPasswordError(key, text);
    if (kind) return kind;
  }
  return null;
}

function RuleRow({
  state,
  label,
  highlight = false,
  message,
}: {
  state: RuleState;
  label: string;
  highlight?: boolean;
  message?: string;
}) {
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
    <li
      className={
        highlight
          ? "-mx-2 rounded-lg bg-destructive/10 px-2 py-1 ring-1 ring-destructive/40"
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {icon}
        <span className={textClass}>{label}</span>
        <span className="sr-only">{srStatus}</span>
      </div>
      {highlight && message ? (
        <p className="mt-1 ms-6 text-xs font-medium text-destructive">{message}</p>
      ) : null}
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
  const [submitFail, setSubmitFail] = useState<FailKind | null>(null);
  const liveRef = useRef<HTMLUListElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target && target.tagName === "INPUT" && target.name === "password") {
        setPassword(target.value);
        setSubmitFail(null);
      }
    };
    root.addEventListener("input", handler, true);
    return () => root.removeEventListener("input", handler, true);
  }, [containerRef]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const detect = () => setSubmitFail(detectPasswordError(root));
    const observer = new MutationObserver(detect);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    detect();
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    if (submitFail) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [submitFail]);

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
    <div ref={cardRef} className="card-premium rounded-2xl px-5 py-4 text-start">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">
          {t("auth.passwordHint.title")}
        </span>
      </div>
      <ul ref={liveRef} className="mt-2 space-y-1.5 text-sm" aria-live="polite">
        <RuleRow
          state={submitFail === "length" ? "fail" : lengthState}
          label={t("auth.passwordHint.minLength")}
          highlight={submitFail === "length"}
          message={t("auth.passwordHint.rejectedLength")}
        />
        <RuleRow
          state={submitFail === "strength" ? "fail" : strengthState}
          label={t("auth.passwordHint.strong")}
          highlight={submitFail === "strength"}
          message={t("auth.passwordHint.rejectedStrength")}
        />
        <RuleRow
          state={submitFail === "breach" ? "fail" : breachState}
          label={t("auth.passwordHint.notBreached")}
          highlight={submitFail === "breach"}
          message={t("auth.passwordHint.rejectedBreach")}
        />
      </ul>
      {submitFail === "generic" ? (
        <p
          className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive ring-1 ring-destructive/40"
          role="alert"
        >
          {t("auth.passwordHint.rejectedGeneric")}
        </p>
      ) : null}
    </div>
  );
}
