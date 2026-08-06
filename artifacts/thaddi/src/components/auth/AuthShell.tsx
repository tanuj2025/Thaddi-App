import React from "react";
import { useI18n } from "../../lib/i18n";
import { ShieldCheck, Trophy, Globe, Sparkles } from "lucide-react";

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
    <div className="w-[460px] max-w-full overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl backdrop-blur-sm">
      <div className="flex flex-col px-6 py-5 sm:px-8 sm:py-6">
        <div className="mb-3 flex flex-col items-center justify-center gap-1.5">
          <img
            src={logoSrc}
            alt={t("app.name")}
            className="h-10 w-auto object-contain drop-shadow-md"
          />
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
            <Sparkles className="h-3 w-3 animate-pulse text-emerald-400" />
            <span>{t('auth.shell.badge')}</span>
          </div>
        </div>
        <h1 className="text-center text-lg font-bold text-foreground tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-center text-xs text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col">{children}</div>

        {/* Professional Collaborations & Trusted Coverage Footer */}
        <div className="mt-5 border-t border-border/60 pt-4 text-center">
          <p className="mb-2.5 text-[10px] font-bold tracking-wider text-muted-foreground/80 uppercase">
            {t('auth.shell.partnersTitle')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-emerald-300 transition hover:border-emerald-500/40 hover:bg-emerald-500/10">
              <Trophy className="h-3 w-3 text-emerald-400" />
              {t('auth.shell.partnerRoshn')}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/5 px-2.5 py-1 text-blue-300 transition hover:border-blue-500/40 hover:bg-blue-500/10">
              <Globe className="h-3 w-3 text-blue-400" />
              {t('auth.shell.partnerPremier')}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-purple-500/20 bg-purple-500/5 px-2.5 py-1 text-purple-300 transition hover:border-purple-500/40 hover:bg-purple-500/10">
              <ShieldCheck className="h-3 w-3 text-purple-400" />
              {t('auth.shell.partnerMoyasar')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

