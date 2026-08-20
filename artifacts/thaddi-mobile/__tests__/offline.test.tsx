import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { I18nProvider } from "@/lib/i18n";

jest.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: jest.fn(),
}));

const mockedUseNetworkStatus = useNetworkStatus as jest.MockedFunction<
  typeof useNetworkStatus
>;

function renderOffline() {
  return render(
    <I18nProvider>
      <OfflineBanner />
    </I18nProvider>,
  );
}

describe("offline recovery screen", () => {
  beforeEach(() => {
    mockedUseNetworkStatus.mockReturnValue({
      isOnline: false,
      isOffline: true,
      isChecking: false,
      checkConnection: jest.fn(async () => false),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("shows a full-screen message instead of leaving a blank app", () => {
    renderOffline();

    expect(screen.getByTestId("offline-retry")).toBeTruthy();
    expect(screen.getByTestId("offline-continue")).toBeTruthy();
  });

  test("allows cached content to continue without hiding the banner", async () => {
    renderOffline();

    fireEvent.press(screen.getByTestId("offline-continue"));

    await waitFor(() => {
      expect(screen.queryByTestId("offline-continue")).toBeNull();
    });
    expect(screen.getByText("وضع عدم الاتصال — يتم عرض البيانات المحفوظة")).toBeTruthy();
  });

  test("closes the full-screen state after a successful retry", async () => {
    const checkConnection = jest.fn(async () => true);
    mockedUseNetworkStatus.mockReturnValue({
      isOnline: false,
      isOffline: true,
      isChecking: false,
      checkConnection,
    });
    const view = renderOffline();

    fireEvent.press(screen.getByTestId("offline-retry"));

    await waitFor(() => {
      expect(checkConnection).toHaveBeenCalledTimes(1);
    });

    // The real hook changes isOffline when the health check succeeds.
    mockedUseNetworkStatus.mockReturnValue({
      isOnline: true,
      isOffline: false,
      isChecking: false,
      checkConnection,
    });
    view.rerender(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("offline-continue")).toBeNull();
    });
  });
});