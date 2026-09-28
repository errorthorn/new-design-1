"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PartyPopper, LayoutDashboard, UserCircle2, X } from "lucide-react";

/**
 * Shown once right after a successful login or signup, no matter where it
 * happened from (speaking club, mock test, payment, or the standalone
 * /login and /signup pages) — see components/auth-welcome-watcher.tsx for
 * how it gets triggered.
 */
export function CongratsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/50 px-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-cream-soft"
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-leaf-50">
              <PartyPopper size={26} className="text-leaf-600" />
            </div>

            <h2 className="mt-4 font-display text-xl font-extrabold text-ink">You&apos;re in! 🎉</h2>
            <p className="mt-2 font-body text-sm text-ink-soft">
              Congratulations — your account is ready. Head to your Dashboard to explore everything
              LingoCraft has to offer: mock tests, the speaking club, vocab battles, and more.
            </p>

            <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-cream-soft px-3 py-2.5 font-body text-xs text-ink-soft">
              <UserCircle2 size={15} className="shrink-0" />
              Tip: tap your profile icon anytime and hit &ldquo;Dashboard&rdquo; to get back here.
            </p>

            <button
              onClick={() => {
                onClose();
                router.push("/dashboard");
              }}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-leaf-600 font-display text-sm font-bold text-white transition-colors hover:bg-leaf-700"
            >
              <LayoutDashboard size={16} />
              Go to Dashboard
            </button>

            <button
              onClick={onClose}
              className="mt-2 flex h-11 w-full items-center justify-center rounded-xl font-body text-sm font-semibold text-ink-soft transition-colors hover:bg-cream-soft"
            >
              Continue here
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
