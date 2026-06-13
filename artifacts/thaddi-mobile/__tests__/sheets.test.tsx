/**
 * BottomSheet consistency render tests.
 *
 * Every pop-up panel in the app routes through the shared `BottomSheet`
 * primitive (`components/ui.tsx`), which renders a consistent grabber + header
 * (title + close) for all sheets. These tests mount real sheets — the
 * JoinByCodeModal (a screen-local sheet) and an account dialog (ChangeMobileSheet)
 * — and assert the shared affordances render. If someone reverts a panel to
 * bespoke markup or breaks the shared primitive, these fail.
 *
 * Sheets are rendered in both Arabic (default, RTL) and English (LTR), mirroring
 * the screen smoke tests, since the header is direction-aware.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { I18nProvider, useI18n } from "@/lib/i18n";

import { JoinByCodeModal } from "@/app/(tabs)/challenges";
import { ChangeMobileSheet } from "@/components/account/dialogs";

/** Flips the i18n language to English once mounted (default is Arabic/RTL). */
function ForceEnglish() {
  const { setLang, lang } = useI18n();
  React.useEffect(() => {
    if (lang !== "en") setLang("en");
  }, [lang, setLang]);
  return null;
}

function renderSheet(
  ui: React.ReactElement,
  { english = false }: { english?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {english ? <ForceEnglish /> : null}
        {ui}
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const SHEETS: Array<{ name: string; element: React.ReactElement }> = [
  {
    name: "JoinByCodeModal",
    element: (
      <JoinByCodeModal
        target={{ id: "challenge-1", name: "Test Challenge" } as never}
        onClose={() => {}}
      />
    ),
  },
  {
    name: "ChangeMobileSheet (account dialog)",
    element: <ChangeMobileSheet visible onClose={() => {}} />,
  },
];

describe("pop-up panels share the BottomSheet header/grabber/close", () => {
  for (const lang of ["ar", "en"] as const) {
    describe(lang === "ar" ? "Arabic (RTL, default)" : "English (LTR)", () => {
      for (const { name, element } of SHEETS) {
        it(`${name} renders the shared header, grabber and close`, async () => {
          const view = renderSheet(element, { english: lang === "en" });
          await waitFor(() => {
            expect(screen.getByTestId("bottom-sheet-grabber")).toBeTruthy();
            expect(screen.getByTestId("bottom-sheet-header")).toBeTruthy();
            expect(screen.getByTestId("bottom-sheet-close")).toBeTruthy();
          });
          view.unmount();
        });
      }
    });
  }
});
