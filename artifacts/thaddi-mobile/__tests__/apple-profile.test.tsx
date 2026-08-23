import { getClerkIdentityName } from "@/lib/apple-profile";

describe("Apple/Clerk identity profile", () => {
  test("uses the persisted full name when available", () => {
    expect(
      getClerkIdentityName({
        fullName: "  Lina Hassan ",
        firstName: "Lina",
        lastName: "Hassan",
      }),
    ).toBe("Lina Hassan");
  });

  test("builds a name from first and last name when fullName is absent", () => {
    expect(
      getClerkIdentityName({ fullName: null, firstName: "Lina", lastName: "Hassan" }),
    ).toBe("Lina Hassan");
  });

  test("does not invent an identity for returning Apple users", () => {
    expect(getClerkIdentityName({ fullName: null, firstName: null, lastName: null })).toBe("");
    expect(getClerkIdentityName(undefined)).toBe("");
  });
});