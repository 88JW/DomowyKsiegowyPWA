import { headers } from "next/headers";

export type SsoIdentity = {
  user: string;
  email: string | null;
};

// Reads identity injected by Traefik forward-auth.
export async function getSsoIdentity(): Promise<SsoIdentity | null> {
  const h = await headers();
  const user = h.get("x-forwarded-user")?.trim();
  const email = h.get("x-forwarded-email")?.trim() || null;

  if (!user) {
    return null;
  }

  return { user, email };
}
