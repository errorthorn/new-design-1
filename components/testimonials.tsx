"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Star } from "lucide-react";
import { Card } from "@/components/ui/card";

type Quote = {
  name: string;
  role: string | null;
  quote: string;
  avatar: string | null;
  rating: number;
  source: "google" | "member";
};

// Fallback shown until /api/testimonials has real rows (or if that fetch
// fails) — swap these for real reviews via /admin/testimonials, or by
// connecting GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID for live Google
// reviews, rather than editing this file.
const fallbackQuotes: Quote[] = [
  {
    name: "Ariana T.",
    role: "IELTS Candidate",
    quote:
      "I used to rehearse sentences in my head before saying them out loud. After a few weeks in the Speaking Club rooms, I just talk — filler words and all.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "A K M Ridwan",
    role: "IELTS Candidate",
    quote:
      "I used to freeze the second an examiner-style follow-up question came my way. The Speaking Club rooms fixed that — small enough that I actually have to talk, every single week.",
    avatar: "/testimonials/akm-ridwan.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Ridoy Hasan",
    role: "IELTS Candidate",
    quote:
      "I joined thinking grammar was my problem. A few Speaking Club sessions in, I realized I'd just never spoken English out loud for a full 2 minutes before — that's what this actually fixed.",
    avatar: "/testimonials/ridoy-hasan.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Rahim K.",
    role: "University Student",
    quote:
      "Six people in the room, not sixty. When it's your turn to answer a Part 3 question, there's nowhere to hide — which is exactly what got me ready for the real test.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Priya S.",
    role: "HSC Candidate",
    quote:
      "I'd done vocabulary apps for a year and my speaking band hadn't moved. Live feedback in an actual conversation is what finally moved it.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Nusrat J.",
    role: "IELTS Candidate",
    quote:
      "The weekly mock test is the only reason I actually know my speaking band is improving, and not just my confidence.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Tanvir A.",
    role: "Member",
    quote:
      "I joined nervous about my accent. Nobody in the room cares — everyone's mid-sentence themselves, just trying to get their point across before time's up.",
    avatar: null,
    rating: 4,
    source: "member",
  },
  {
    name: "Ashraf N.",
    role: "Member",
    quote:
      "Somewhere around week five I stopped translating from Bangla in my head before I spoke. Didn't even notice until it had already happened, mid-conversation, in one of the rooms.",
    avatar: "/testimonials/asraf-islam.jpeg",
    rating: 5,
    source: "member",
  },
  {
    name: "Md Sarwar Islam",
    role: "University Student",
    quote:
      "Between classes and everything else, I didn't think I'd stick with a routine. The Speaking Club slots are short enough to fit into a study break, and the mock test keeps me honest about where my band actually is.",
    avatar: "/testimonials/md-sarwar-islam.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Imran H.",
    role: "University Student",
    quote:
      "Vocab Battle turned memorizing word lists into something I actually looked forward to before my Speaking Club session each week.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Sadia K.",
    role: "IELTS Candidate",
    quote:
      "Twenty-five minutes doesn't sound like much until you realize it's the only English you actually speak out loud all week.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Afroza Anisha",
    role: "IELTS Candidate",
    quote:
      "My host remembered a mistake I'd made two weeks earlier and asked if I'd fixed it. That's not an app tracking a streak — that's someone actually coaching you.",
    avatar: "/testimonials/afroza-anisha.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Khadijatul Kubra",
    role: "Member",
    quote:
      "The host corrects you mid-sentence instead of waiting until you're done talking. That's what actually made it stick for me.",
    avatar: "/testimonials/khadijatul-kubra.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Omar F.",
    role: "Member",
    quote:
      "The Study Planner is what finally got me to stop cramming vocabulary the night before a mock test.",
    avatar: null,
    rating: 4,
    source: "member",
  },
  {
    name: "Mahin S.",
    role: "University Student",
    quote:
      "I record myself in mock test sessions now just to compare with last month. The difference shows up on the scoresheet, not just in how confident I feel.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Lamia T.",
    role: "University Student",
    quote:
      "Every Speaking Club room has a different mix of people, so I'm never just repeating the same comfortable conversation I already know how to have.",
    avatar: null,
    rating: 4,
    source: "member",
  },
  {
    name: "Kamrul I.",
    role: "IELTS Candidate",
    quote:
      "Speaking used to be the band I was most scared of. After a couple of months of weekly rooms and mock tests, it's the one I actually feel ready for.",
    avatar: null,
    rating: 5,
    source: "member",
  },
  {
    name: "Shahadat Hossain",
    role: "IELTS Candidate",
    quote:
      "I stopped rehearsing answers in my head before mock test sessions. Now I just talk, take the feedback, and try again the following week.",
    avatar: "/testimonials/shahadat-hossain.jpg",
    rating: 5,
    source: "member",
  },
  {
    name: "Megla Akter",
    role: "Member",
    quote:
      "I joined right before my IELTS speaking test. I stayed because the Tuesday room became the one part of my week where I actually spoke English out loud.",
    avatar: "/testimonials/megla-akter.png",
    rating: 5,
    source: "member",
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Google-contacts-style fallback avatars: a solid colour circle with white
// initials, same idea as the "Md" avatar in the dashboard header for a
// signed-in user with no Google photo. The colour is picked deterministically
// from the name so the same person always lands on the same colour across
// renders/refreshes, without needing to store a colour per testimonial.
const AVATAR_COLORS = [
  "#F97316", // orange
  "#3B82F6", // blue
  "#10B981", // emerald
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F59E0B", // amber
  "#6366F1", // indigo
  "#84CC16", // lime
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Google's official four-colour "G" mark — used only on cards that are
// genuinely sourced from the Google Places API (source: "google"), never
// on member-submitted testimonials, so the badge always means what it says.
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.5 0-14 4.2-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 34.9 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.9 39.6 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.6 5.6C41.5 36 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          className={n <= rating ? "fill-amber-400 text-amber-400" : "fill-transparent text-ink/15"}
        />
      ))}
    </div>
  );
}

function ReviewCard({ q, fluid = false }: { q: Quote; fluid?: boolean }) {
  return (
    <Card
      className={`testimonial-glow shrink-0 border-2 border-ink/10 bg-cream-soft p-5 ${
        fluid ? "w-full" : "w-[320px] sm:w-[360px]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {q.avatar ? (
            <img
              src={q.avatar}
              alt={q.name}
              className="h-11 w-11 shrink-0 rounded-full border-2 border-ink/10 object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
              style={{ backgroundColor: avatarColor(q.name) }}
            >
              {initials(q.name)}
            </div>
          )}
          <div>
            <p className="font-display text-sm font-semibold text-ink">{q.name}</p>
            <StarRow rating={q.rating} />
          </div>
        </div>
        {q.source === "google" && <GoogleMark className="h-5 w-5 shrink-0" />}
      </div>

      <p className="mt-4 line-clamp-4 font-body text-sm leading-relaxed text-ink-soft">
        “{q.quote}”
      </p>
    </Card>
  );
}

// Mobile-only: one review at a time, sliding in/out with a real
// animation (matches the "one card, then the next slides in" reference)
// instead of two auto-scrolling rows, which is too busy to read on a
// phone screen. Auto-advances every few seconds; swiping or tapping a
// dot jumps straight there and the auto-advance timer restarts from that
// point.
function MobileTestimonialCarousel({ quotes }: { quotes: Quote[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    if (quotes.length < 2) return;
    const id = setTimeout(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % quotes.length);
    }, 5000);
    return () => clearTimeout(id);
  }, [index, quotes.length]);

  const goTo = (i: number) => {
    setDirection(i > index ? 1 : -1);
    setIndex(i);
  };

  if (!quotes.length) return null;
  const current = quotes[index];

  return (
    <div className="sm:hidden">
      <div className="relative overflow-hidden px-6">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            initial={{ x: direction > 0 ? 48 : -48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction > 0 ? -48 : 48, opacity: 0 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => {
              if (info.offset.x < -50) goTo((index + 1) % quotes.length);
              else if (info.offset.x > 50) goTo((index - 1 + quotes.length) % quotes.length);
            }}
            className="mx-auto max-w-[360px]"
          >
            <ReviewCard q={current} fluid />
          </motion.div>
        </AnimatePresence>
      </div>

      {quotes.length > 1 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-6">
          {quotes.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show review ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-2 rounded-pill transition-all ${
                i === index ? "w-6 bg-leaf-600" : "w-2 bg-ink/15"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Splits the combined list into two roughly-even rows and duplicates each
// row's content once, so the CSS marquee (translateX 0 → -50%) loops
// seamlessly no matter how many quotes are loaded.
function useMarqueeRows(quotes: Quote[]) {
  return useMemo(() => {
    const row1 = quotes.filter((_, i) => i % 2 === 0);
    const row2 = quotes.filter((_, i) => i % 2 === 1);
    return {
      row1: row1.length ? [...row1, ...row1] : [],
      row2: row2.length ? [...row2, ...row2] : [],
    };
  }, [quotes]);
}

export function Testimonials() {
  const [quotes, setQuotes] = useState<Quote[]>(fallbackQuotes);
  const [googleSummary, setGoogleSummary] = useState<{ rating: number; total: number } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/testimonials")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.testimonials?.length) setQuotes(data.testimonials);
        if (data?.googleSummary) setGoogleSummary(data.googleSummary);
      })
      .catch(() => {
        // Keep the fallback quotes — homepage should never show empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { row1, row2 } = useMarqueeRows(quotes);

  return (
    <section id="testimonials" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-4 px-6 text-center"
        >
          <div>
            <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
              Members say
            </span>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
              Their Words, Our Motivation
            </h2>
          </div>

          {googleSummary && (
            <div className="flex items-center gap-2 rounded-pill border border-ink/10 bg-cream-soft px-4 py-2">
              <GoogleMark className="h-5 w-5" />
              <span className="font-display text-sm font-bold text-ink">
                {googleSummary.rating.toFixed(1)}
              </span>
              <StarRow rating={Math.round(googleSummary.rating)} />
              <span className="font-body text-xs text-ink-soft">
                ({googleSummary.total} Google reviews)
              </span>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, filter: "blur(8px)" }}
        whileInView={{ opacity: 1, filter: "blur(0px)" }}
        viewport={{ once: false, margin: "-60px" }}
        transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
        className="mt-12"
      >
        <MobileTestimonialCarousel quotes={quotes} />

        <div className="hidden space-y-5 sm:block">
          <div className="marquee-row">
            <div className="marquee-track flex w-max gap-5">
              {row1.map((q, i) => (
                <ReviewCard key={`r1-${q.name}-${i}`} q={q} />
              ))}
            </div>
          </div>

          <div className="marquee-row">
            <div className="marquee-track-reverse flex w-max gap-5">
              {row2.map((q, i) => (
                <ReviewCard key={`r2-${q.name}-${i}`} q={q} />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
