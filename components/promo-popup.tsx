"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X, Gift, ArrowRight } from "lucide-react";

// Bump the suffix (v1 -> v2) any time the offers/copy inside change, so
// returning visitors who already dismissed the old version see the new
// one instead of it staying hidden forever. sessionStorage (not
// localStorage) on purpose — this is meant to greet someone once per
// visit, not nag them on every single page load within that visit, but
// it's fine for it to show again next time they open the site fresh.
const SESSION_KEY = "lc_promo_popup_seen_v1";

export function PromoPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // Storage blocked (private mode, etc.) — just show it every time
      // rather than crashing.
    }
    // A short delay so it doesn't compete with the page's own entrance
    // animations — the popup arrives a beat after the page does.
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Lock background scroll while the popup is open — matters most on
    // mobile, where the page behind it would otherwise scroll under a
    // user's thumb while they're trying to read the card.
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative flex w-full max-w-md max-h-[92vh] flex-col overflow-y-auto rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-leaf-500 bg-white text-leaf-600 transition-colors hover:bg-leaf-50 sm:right-4 sm:top-4"
            >
              <X size={16} />
            </button>

            <div className="bg-gradient-to-br from-leaf-500 to-leaf-700 px-5 pb-6 pt-5 text-white sm:px-6 sm:pb-7 sm:pt-6">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-leaf-500 bg-white px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wide text-leaf-600 sm:text-xs">
                Limited-time offers
              </span>
              <h2 className="mt-3 font-display text-xl font-extrabold leading-tight sm:text-2xl">
                Unlock Exclusive Offers 🎁
              </h2>
              <p className="mt-1 font-body text-sm text-white/85">
                Grab either one — or both — before they&apos;re gone.
              </p>
            </div>

            <div className="space-y-3 px-5 py-4 sm:space-y-3.5 sm:px-6 sm:py-5">
              {/* Offer 1: Buy 1 Get 1 Free on Pro */}
              <div className="rounded-2xl border-2 border-leaf-500/30 bg-leaf-50 p-3.5 dark:bg-leaf-500/10 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-[15px] font-bold text-ink sm:text-base">Buy 1 Get 1 Free</p>
                    <p className="mt-0.5 font-body text-sm text-ink-soft">
                      Pay for 1 month of Pro, get 2 months of access.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-leaf-500 px-2.5 py-1 font-display text-[11px] font-bold text-white sm:text-xs">
                    PRO
                  </span>
                </div>
                <Link
                  href="/pricing"
                  onClick={close}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-pill bg-leaf-500 px-4 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-leaf-600 sm:w-auto sm:py-2"
                >
                  Claim this offer <ArrowRight size={14} />
                </Link>
              </div>

              {/* Offer 2: Refer & Earn */}
              <div className="rounded-2xl border-2 border-ink/10 bg-cream-soft p-3.5 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-[15px] font-bold text-ink sm:text-base">Refer &amp; Earn</p>
                    <p className="mt-0.5 font-body text-sm text-ink-soft">
                      Refer a friend — you both get 25% off your next payment.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-ink text-white px-2.5 py-1 font-display text-[11px] font-bold sm:text-xs">
                    25% OFF
                  </span>
                </div>
                <Link
                  href="/dashboard/refer"
                  onClick={close}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-pill border border-ink/15 bg-white px-4 py-2.5 font-body text-sm font-semibold text-ink transition-colors hover:bg-cream-soft sm:w-auto sm:py-2"
                >
                  <Gift size={14} /> Refer a friend
                </Link>
              </div>
            </div>

            <button
              onClick={close}
              className="block w-full pb-4 pt-1 text-center font-body text-xs text-ink-soft/60 transition-colors hover:text-ink-soft sm:pb-5"
            >
              Maybe later
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
