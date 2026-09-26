"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, MessageCircle, BookOpen, PenLine, Volume2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

// Second headline line cycles through these — first line stays put,
// this part types in, holds, deletes, and moves to the next phrase.
const typedPhrases = ["real confidence.", "real fluency.", "real clarity."];

// Each card floats independently (staggered animation-delay). desktopPosition
// is tuned for the 360px sm+ orbit box; mobilePosition is tuned for the
// separate, smaller 240px mobile-only orbit box below (see hero markup) —
// kept flush inside that box's edges (no negative overhang) so it can
// never get clipped on a narrow phone screen.
const scoreBars = [
  {
    label: "Fluency & Coherence",
    score: 8.5,
    icon: MessageCircle,
    desktopPosition: "-left-7 top-4",
    mobilePosition: "left-2 top-2",
    delay: "0s",
  },
  {
    label: "Lexical Resource",
    score: 7.5,
    icon: BookOpen,
    desktopPosition: "-right-9 top-16",
    mobilePosition: "right-2 top-2",
    delay: "1.4s",
  },
  {
    label: "Grammatical Range",
    score: 8,
    icon: PenLine,
    desktopPosition: "-left-6 bottom-14",
    mobilePosition: "left-2 bottom-2",
    delay: "2.6s",
  },
  {
    label: "Pronunciation",
    score: 8,
    icon: Volume2,
    desktopPosition: "-right-7 bottom-2",
    mobilePosition: "right-2 bottom-2",
    delay: "0.8s",
  },
];

// Popularity stats shown in the hero. Placeholder round numbers — swap
// `target` for the real figures whenever you have them; the count-up
// animation will keep working the same way.
const stats = [
  { target: 500, decimals: 0, suffix: "+", label: "Active members" },
  { target: 10000, decimals: 0, suffix: "+", label: "Sessions completed" },
  { target: 4.8, decimals: 1, suffix: "", label: "Avg rating" },
  { target: 2500, decimals: 0, suffix: "+", label: "Speaking hours logged" },
];

function CountUpStat({
  target,
  decimals = 0,
  suffix = "",
}: {
  target: number;
  decimals?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [started, setStarted] = useState(false);
  const [value, setValue] = useState(0);

  // Trigger once the stat enters the viewport — fires on load if it's
  // already visible, and on scroll from either direction otherwise.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Animate the number upward with an ease-out curve, starting from a
  // point close to the target rather than a bare 0 — reads more natural.
  useEffect(() => {
    if (!started) return;
    const duration = 1100;
    const startValue = target * 0.55;
    const startTime = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(startValue + (target - startValue) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [started, target]);

  const display =
    decimals > 0
      ? value.toFixed(decimals)
      : Math.round(value).toLocaleString();

  return (
    <p ref={ref} className="font-display text-2xl font-extrabold text-ink">
      {display}
      {suffix}
    </p>
  );
}

function useTypewriter(phrases: string[]) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[phraseIndex];
    let delay = isDeleting ? 55 : 100;

    if (!isDeleting && text === current) {
      delay = 2200; // hold on the full phrase
    } else if (isDeleting && text === "") {
      delay = 450; // brief pause before the next phrase starts typing
    }

    const timeout = setTimeout(() => {
      if (!isDeleting && text === current) {
        setIsDeleting(true);
        return;
      }
      if (isDeleting && text === "") {
        setIsDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
        return;
      }
      setText((t) =>
        isDeleting ? current.slice(0, t.length - 1) : current.slice(0, t.length + 1)
      );
    }, delay);

    return () => clearTimeout(timeout);
  }, [text, isDeleting, phraseIndex, phrases]);

  return text;
}

export function Hero() {
  const typed = useTypewriter(typedPhrases);
  const overallScore =
    scoreBars.reduce((sum, bar) => sum + bar.score, 0) / scoreBars.length;

  return (
    <section className="relative overflow-hidden px-6 pb-10 pt-16 md:pb-14 md:pt-24">
      {/* subtle doodle-pattern background — sits behind all hero content,
          faded top-to-bottom so it reads as texture, not noise, and never
          competes with the copy or the score visual. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[url('/hero-doodle-pattern.png')] bg-cover bg-top opacity-70 [mask-image:linear-gradient(to_bottom,black,black_45%,transparent_92%)] [-webkit-mask-image:linear-gradient(to_bottom,black,black_45%,transparent_92%)] md:h-[680px]"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 md:grid-cols-2 md:gap-20 lg:gap-28">
        {/* ---------- left: copy ---------- */}
        <div>
          <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.15] tracking-tight text-ink md:text-6xl">
            Speak English with
            <br />
            <span className="text-leaf-600">
              {typed}
              <span className="animate-pulse text-leaf-600">|</span>
            </span>
          </h1>

          <p className="mt-6 max-w-md font-body text-lg text-ink/70">
            90% of our members say their speaking confidence improved after
            just their first week. Real mentor feedback plus a live
            problem-solving class with an expert mentor — you&apos;ll feel
            the difference fast.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href="/pricing" className={buttonVariants({ variant: "accent", size: "lg" }) + " gap-2.5"}>
              Join LingoCraft Speaking Club
              <ArrowRight size={18} />
            </a>
            <a href="#how-it-works" className={buttonVariants({ variant: "outline", size: "lg" })}>
              See How It Works
            </a>
          </div>
        </div>

        {/* ---------- right: score visual ---------- */}
        <div className="mx-auto w-full max-w-sm">
          {/* Single implementation for every screen size — the orbit
              circle + floating stat cards are laid out once, exactly as
              designed for desktop, and simply scaled down proportionally
              on phones via CSS transform. This guarantees the mobile
              layout is pixel-for-pixel identical to desktop (same card
              positions, same overhang over the ring, same float
              animation) — just smaller. The outer wrapper is sized to
              match the scaled-down footprint so there's no leftover
              blank space, and nothing here ever gets clipped because the
              scale factor was chosen to leave breathing room down to a
              320px-wide phone. */}
          <div className="relative mx-auto h-[270px] w-[270px] sm:h-[360px] sm:w-[360px]">
            <div className="absolute left-0 top-0 h-[360px] w-[360px] origin-top-left scale-[0.75] sm:scale-100">
              {/* dashed orbit ring */}
              <div className="absolute inset-0 rounded-full border border-dashed border-leaf-300/60" />

              {/* dot that travels around the ring — rotating the full-size
                  wrapper carries the dot (fixed at the top edge) around the
                  circle; the dot itself never spins in place. */}
              <div className="absolute inset-0 animate-[spin_9s_linear_infinite]">
                <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-leaf-500 ring-4 ring-leaf-100" />
              </div>

              {/* center circle: overall score */}
              <div className="absolute left-1/2 top-1/2 flex h-[168px] w-[168px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-leaf-100 bg-white shadow-[0_25px_60px_-20px_rgba(21,23,15,0.25)]">
                <span className="font-display text-5xl font-extrabold text-leaf-600">
                  {overallScore.toFixed(1)}
                </span>
                <span className="mt-1 font-body text-[10px] font-semibold uppercase tracking-wider text-ink/50">
                  Overall score
                </span>
              </div>

              {/* floating stat cards, each bobbing on its own delay */}
              {scoreBars.map((bar) => {
                const Icon = bar.icon;
                return (
                  <div
                    key={bar.label}
                    className={`absolute w-[132px] animate-float-slow rounded-xl border border-ink/5 bg-white px-3.5 py-2.5 shadow-[0_15px_30px_-10px_rgba(21,23,15,0.18)] ${bar.desktopPosition}`}
                    style={{ animationDelay: bar.delay }}
                  >
                    <div className="flex items-center gap-1.5 font-body text-[9px] font-semibold uppercase tracking-wide text-ink/50">
                      <Icon size={11} className="text-leaf-600" />
                      {bar.label}
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-display text-lg font-extrabold text-ink">
                        {bar.score.toFixed(1)}
                      </span>
                      <span className="font-body text-[10px] text-ink/40">/9</span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-pill bg-leaf-50">
                      <div
                        className="h-full rounded-pill bg-leaf-500"
                        style={{ width: `${(bar.score / 9) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* stat strip */}
      <div className="relative mx-auto mt-10 grid max-w-6xl grid-cols-2 gap-5 md:mt-14 md:max-w-3xl md:grid-cols-4 md:gap-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-ink/5 bg-white px-6 py-5 text-center shadow-sm"
          >
            <CountUpStat target={stat.target} decimals={stat.decimals} suffix={stat.suffix} />
            <p className="mt-1 font-body text-xs text-ink/60">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
