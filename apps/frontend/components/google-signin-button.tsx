"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/api";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

export function GoogleSignInButton({ next = "/dashboard", onMfaRequired }: { next?: string; onMfaRequired?: (mfaToken: string) => void }) {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !loaded || !window.google || !ref.current) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        try {
          const challenge = await loginWithGoogle(credential);
          if (challenge) {
            if (onMfaRequired) return onMfaRequired(challenge.mfaToken);
            return setError("This account uses two-factor authentication. Sign in from the sign-in page.");
          }
          router.replace(next);
        } catch (err) {
          setError(errorMessage(err, "Google sign-in failed"));
        }
      },
    });
    window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: "384", text: "continue_with" });
  }, [clientId, loaded, loginWithGoogle, next, router, onMfaRequired]);

  if (!clientId) return null;
  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setLoaded(true)} onReady={() => setLoaded(true)} />
      <div ref={ref} className="flex min-h-[44px] justify-center" />
      {error && <p className="mt-2 text-center text-xs text-danger">{error}</p>}
    </>
  );
}
