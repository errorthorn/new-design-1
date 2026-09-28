"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

// TODO: this whole card is a stand-in for a real founder photo — same visual
// slot the Philosophy section's photo sits in on the homepage. Swap the
// avatar circle below for an <Image src="/founder-photo.jpg" .../> the same
// way philosophy.tsx does, whenever you have one. Name/role text is real;
// only the "photo" part is placeholder.
function FounderCard() {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(8px)", x: -120, rotate: -3 }}
      whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, rotate: 0 }}
      viewport={{ once: false }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="group relative order-2 md:order-1"
    >
      <div className="absolute -top-5 -left-5 -z-10 h-full w-full rounded-[2rem] bg-[#7ED856] transition-transform duration-300 ease-out group-hover:-translate-x-2 group-hover:-translate-y-2" />

      <div className="relative flex h-[320px] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-[2rem] bg-gradient-to-br from-ink to-ink-soft shadow-[0_1px_0_0_rgba(21,23,15,0.04)] transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_28px_55px_-12px_rgba(63,122,42,0.5)] md:h-[380px]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#7ED856]/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-[#7ED856]/10 blur-2xl" />

        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-[#7ED856] bg-[#7ED856]/15 font-display text-3xl font-bold text-[#7ED856] transition-transform duration-300 group-hover:scale-105">
          MI
        </div>
        <div className="relative text-center">
          <p className="font-display text-lg font-semibold text-cream">
            Md Irfan
          </p>
          <p className="font-body text-sm text-cream/60">
            Founder, LingoCraft
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function AboutStory() {
  return (
    <section id="our-story" className="relative overflow-hidden px-6 pb-20 pt-16 md:pb-28 md:pt-24">
      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.4 }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Our Story
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
            LingoCraft didn&apos;t start as a business plan.
          </h1>
        </motion.div>

        <div className="mt-14 grid items-center gap-14 md:grid-cols-2">
          <FounderCard />

          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            viewport={{ once: false, margin: "-60px" }}
            transition={{ duration: 0.4 }}
            className="order-1 md:order-2"
          >
            <p className="font-body text-base leading-relaxed text-ink-soft">
              {/* TODO: this is a plausible founder story shaped around the
                  site's existing philosophy ("you speak first, rules come
                  later") — swap in your actual details (what exam/moment
                  triggered it, how long you struggled, etc.) wherever it
                  doesn't match your real experience. */}
              It started the way it does for most people preparing for IELTS —
              hours spent on grammar rules, vocabulary lists, and sample
              answers, all of it making perfect sense on paper. Then came an
              actual conversation, and every rule went quiet. Not because the
              knowledge wasn&apos;t there — because there was nowhere to
              actually use it out loud, under pressure, before the test that
              mattered.
            </p>
            <p className="mt-4 font-body text-base leading-relaxed text-ink-soft">
              That gap — between knowing English and speaking it — is what
              LingoCraft was built to close. Not another course to sit
              through, but a room to show up to every day and just talk:
              real topics, real people, real correction on the spot. The
              kind of practice that would have made that first real
              conversation a lot less terrifying.
            </p>

            <div className="mt-6 flex items-start gap-3 rounded-2xl border-2 border-[#7ED856]/70 bg-cream/40 p-5">
              <Quote size={20} className="mt-0.5 shrink-0 text-leaf-600" />
              <p className="font-display text-base italic text-ink">
                We built the daily speaking practice we wished existed — so
                no one else has to learn fluency the hard, silent way.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
