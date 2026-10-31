"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CongratsModal } from "@/components/congrats-modal";

// useSearchParams() requires a Suspense boundary around it in the app
// router, or the build fails (same reason app/payment/page.tsx and the
// /login and /signup forms wrap themselves in <Suspense> — see those
// files) — hence the wrapper export at the bottom.
function Watcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("welcome") === "1") {
      setOpen(true);
    }
    // Only re-run when the marker itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("welcome")]);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Strip the marker so refreshing, sharing, or hitting back doesn't
    // replay the popup — everything else in the query string is kept.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("welcome");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return <CongratsModal open={open} onClose={handleClose} />;
}

export function AuthWelcomeWatcher() {
  return (
    <Suspense fallback={null}>
      <Watcher />
    </Suspense>
  );
}
