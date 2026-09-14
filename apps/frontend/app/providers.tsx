"use client";

import { SWRConfig } from "swr";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RealtimeProvider } from "@/lib/realtime";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell/app-shell";
import { ApiError } from "@/lib/api";

function Realtime({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <RealtimeProvider enabled={!!user}>{children}</RealtimeProvider>;
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" closeButton richColors toastOptions={{ className: "text-[13px]" }} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SWRConfig
        value={{
          // Don't hammer the API on auth/permission errors.
          shouldRetryOnError: (err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)),
          errorRetryCount: 3,
        }}
      >
        <AuthProvider>
          <Realtime>
            <TooltipProvider>
              <AppShell>{children}</AppShell>
              <ThemedToaster />
            </TooltipProvider>
          </Realtime>
        </AuthProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
