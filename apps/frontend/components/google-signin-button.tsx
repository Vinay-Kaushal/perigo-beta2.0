"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

export function GoogleSignInButton() {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;

    function render() {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId!,
        callback: async ({ credential }) => {
          try {
            await loginWithGoogle(credential);
            router.push("/dashboard");
          } catch {
            // The form below already shows a generic error state for
            // password auth; a failed Google credential just leaves the
            // button as-is so the person can retry.
          }
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        width: "320",
      });
    }

    if (window.google) render();
    else {
      const interval = setInterval(() => {
        if (window.google) {
          render();
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null; // not configured — silently omit rather than show a broken button

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <div ref={buttonRef} className="flex justify-center" />
    </>
  );
}
