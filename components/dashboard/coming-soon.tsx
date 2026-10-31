import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        {description}
      </p>

      <div className="mt-6 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
          <Icon size={26} />
        </div>
        <p className="mt-5 font-display text-lg font-semibold">
          This section is being built next
        </p>
        <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
          The {title} page will get its own design and features here — this is just
          holding its spot in the dashboard for now.
        </p>
      </div>
    </div>
  );
}
