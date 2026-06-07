// Extracts a human-readable message from a Clerk SDK error, falling back to a
// caller-provided (localized) message when the error shape is unrecognized.
export function clerkErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as
    | { errors?: Array<{ longMessage?: string; message?: string }>; message?: string }
    | undefined;
  const first = anyErr?.errors?.[0];
  return first?.longMessage || first?.message || anyErr?.message || fallback;
}
