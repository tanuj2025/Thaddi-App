type ClerkIdentity = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Apple supplies a name on the first authorization and Clerk persists it on
 * the user. Returning Apple sign-ins may not receive the name again, so this
 * deliberately reads the persisted Clerk identity instead of prompting again.
 */
export function getClerkIdentityName(user: ClerkIdentity | null | undefined): string {
  const fullName = user?.fullName?.trim();
  if (fullName) return fullName;

  return [user?.firstName, user?.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}