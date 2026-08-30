import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";

/**
 * The "you can't see this yet" card shown on subscription-gated dashboard
 * pages (Quiz, Mistake Log, Class Notes) — not logged in, subscription
 * inactive, or a plain fetch error. Centralized so every gated page looks
 * and behaves the same way instead of each screen growing its own
 * slightly-different locked state.
 */
export function AccessGate({
  status,
  message,
  icon: Icon = Lock,
  requiresPlan,
}: {
  status: "unauthorized" | "forbidden" | "error";
  message: string;
  icon?: LucideIcon;
  /** Set when a 403 came with `requiresPlan: "pro"` — the account has an
   * active subscription already, it's just not the right tier, so the CTA
   * should say "Upgrade" rather than "Activate" (which would be
   * confusing for someone who's already paying). */
  requiresPlan?: string;
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
        <Icon size={26} />
      </div>
      <p className="mt-5 font-display text-lg font-semibold">{message}</p>
      {status === "unauthorized" && (
        <Link
          href="/login"
          className="mt-4 rounded-pill bg-leaf-500 px-5 py-2 font-body text-sm font-semibold text-white hover:bg-leaf-600"
        >
          Log in
        </Link>
      )}
      {status === "forbidden" && (
        <Link
          href="/payment"
          className="mt-4 rounded-pill bg-leaf-500 px-5 py-2 font-body text-sm font-semibold text-white hover:bg-leaf-600"
        >
          {requiresPlan ? "Upgrade to Pro" : "Activate membership"}
        </Link>
      )}
    </div>
  );
}
