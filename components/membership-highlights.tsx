"use client";

import Image from "next/image";
import { motion } from "framer-motion";

type HighlightItem = {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  photo: string; // drop the real photo into /public with this filename
  alt: string;
};

// TODO: replace each `photo` path with a real photo dropped into /public.
// Until then Next/Image will 404 on these — swap the filenames once you
// have the shots, no code changes needed.
const items: HighlightItem[] = [
  {
    id: "daily-practice",
    index: "01",
    eyebrow: "Every single day",
    title: "A new partner, a new topic, every day.",
    body: "Get matched with a different speaking partner daily and talk through a fresh topic for an hour — real conversation, not drills.",
    photo: "/membership-daily-practice.jpg",
    alt: "Two members on a daily speaking practice call",
  },
  {
    id: "vocabulary",
    index: "02",
    eyebrow: "Words that actually stick",
    title: "Vocabulary built around what you're saying.",
    body: "Every topic comes with its own word list, so you learn it by using it in conversation — not by memorizing flashcards.",
    photo: "/membership-vocabulary.jpg",
    alt: "Member reviewing topic-wise vocabulary notes",
  },
  {
    id: "mock-test",
    index: "03",
    eyebrow: "Scored by a mentor, not a script",
    title: "A weekly mock test — and a mentor who tells you why.",
    body: "Sit a full mock speaking test every week and get a band score plus personalised feedback from a real mentor.",
    photo: "/membership-mock-test.jpg",
    alt: "Mentor giving personalised feedback after a weekly mock test",
  },
  {
    id: "problem-solving",
    index: "04",
    eyebrow: "Built around what you got wrong",
    title: "A weekly class built around your feedback.",
    body: "Your mentor's feedback becomes that week's problem-solving class — plus a recording and slide PDF to revisit anytime.",
    photo: "/membership-problem-solving.jpg",
    alt: "Weekly problem-solving class in session",
  },
  {
    id: "speaking-contest",
    index: "05",
    eyebrow: "Put it to the test",
    title: "Compete in the monthly Speaking Contest.",
    body: "Step up in front of the whole club and put months of practice on the line — real stakes, real recognition.",
    photo: "/membership-speaking-contest.jpg",
    alt: "Member competing in the monthly speaking contest",
  },
];

export function MembershipHighlights() {
  return (
    <section
      id="membership-highlights"
      className="relative overflow-hidden bg-[#101609] px-6 py-20 md:py-28"
    >
      {/* ambient blooms — same family as the pricing card's dark theme,
          so this section reads as the on-ramp to it */}
      <div className="pointer-events-none absolute -left-24 top-0 h-96 w-96 rounded-full bg-[#7ED856]/10 blur-[110px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#7ED856]/10 blur-[110px]" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-xl text-center">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-500">
            Everything in your membership
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-cream md:text-4xl">
            One plan. Five reasons it works.
          </h2>
          <p className="mx-auto mt-3 max-w-md font-body text-cream/60">
            Every card below is a real part of the club — no stock icons,
            just what actually happens every week.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 28, scale: 0.94 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: false, margin: "-60px" }}
              transition={{ duration: 0.45, delay: (i % 3) * 0.08, ease: "easeOut" }}
              className={
                "group relative rounded-[1.75rem] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-3 ring-1 ring-inset ring-white/10 transition-all duration-300 hover:-translate-y-1 hover:ring-leaf-500/40 " +
                (i >= 3 ? "lg:col-start-auto" : "")
              }
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.25rem] bg-[#1c2513]">
                <Image
                  src={item.photo}
                  alt={item.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                />
                {/* duotone leaf wash — the "different effect" for this
                    section: a flat color overlay + numbered badge, instead
                    of the blurred mask treatment used in the Showcase
                    section above. */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#101609] via-[#101609]/25 to-transparent" />
                <div className="absolute inset-0 bg-leaf-500/10 mix-blend-overlay" />

                <span className="absolute left-4 top-4 font-display text-xs font-bold tracking-wider text-cream/50">
                  {item.index}
                </span>
              </div>

              <div className="px-2 pb-3 pt-5">
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-leaf-500">
                  {item.eyebrow}
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold leading-snug text-cream">
                  {item.title}
                </h3>
                <p className="mt-2 font-body text-sm leading-relaxed text-cream/60">
                  {item.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
