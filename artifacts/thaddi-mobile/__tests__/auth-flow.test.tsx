import { completeSSOFlow } from "@/lib/sso";
import { nextActivationRoute } from "@/lib/activation";

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_test",
    email: "test@example.com",
    emailVerified: true,
    realName: "Test User",
    displayName: "Test User",
    username: "test_user",
    avatarUrl: null,
    mobileNumber: null,
    mobileVerified: false,
    role: "user",
    level: 1,
    totalPoints: 0,
    profileComplete: true,
    favoriteTeamSelected: false,
    favoriteTeam: null,
    favoriteClubSelected: false,
    favoriteClub: null,
    activated: false,
    hidePredictions: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as any;
}

describe("mobile authentication and activation flow", () => {
  test("new Google users use the normal mobile-verification activation step", () => {
    expect(nextActivationRoute(user())).toBe("/(activation)/verify-mobile");
  });

  test("activation continues to favourite-team selection after mobile verification", () => {
    expect(
      nextActivationRoute(user({ mobileVerified: true })),
    ).toBe("/(activation)/pick-team");
  });

  test("only a fully activated account reaches the tabs", () => {
    expect(
      nextActivationRoute(
        user({ mobileVerified: true, favoriteTeamSelected: true }),
      ),
    ).toBe("/(tabs)");
  });

  test("Google sign-in activates an existing user's returned sign-in session", async () => {
    const setActive = jest.fn(async () => undefined);
    const navigate = jest.fn();
    const completed = await completeSSOFlow(
      {
        createdSessionId: null,
        setActive,
        signIn: {
          status: "complete",
          createdSessionId: "sess_existing_google",
        },
      } as any,
      navigate,
    );

    expect(completed).toBe(true);
    expect(setActive).toHaveBeenCalledWith({
      session: "sess_existing_google",
      navigate,
    });
  });

  test("Google sign-up activates a new user's returned session", async () => {
    const setActive = jest.fn(async () => undefined);
    const navigate = jest.fn();
    const completed = await completeSSOFlow(
      {
        createdSessionId: "sess_new_google",
        setActive,
        signUp: { status: "complete", createdSessionId: "sess_new_google" },
      } as any,
      navigate,
    );

    expect(completed).toBe(true);
    expect(setActive).toHaveBeenCalledWith({
      session: "sess_new_google",
      navigate,
    });
  });
});