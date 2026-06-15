import React from "react";
import { useI18n } from "../../lib/i18n";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const logoSrc = `${basePath}/logo.png`;

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="w-[440px] max-w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="flex flex-col px-8 py-7">
        <div className="mb-4 flex justify-center">
          <img
            src={logoSrc}
            alt={t("app.name")}
            className="h-12 w-auto object-contain"
          />
        </div>
        <h1 className="text-center text-xl font-bold text-foreground">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-center text-sm text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
