"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export function AboutCommunity() {
  return (
    <section id="who-its-for" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.4 }}
        >
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Who It&apos;s For
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            You don&apos;t join because you&apos;re bad at English.
          </h2>

          <p className="mt-5 font-body text-base leading-relaxed text-ink-soft">
            You join because you&apos;re tired of being good at it only on
            paper. Most people who find LingoCraft can already read, write,
            and pass a grammar test without much trouble. What they don&apos;t
            have is a room where speaking out loud — mid-sentence mistakes and
            all — feels normal instead of exposing.
          </p>
          <p className="mt-4 font-body text-base leading-relaxed text-ink-soft">
            That&apos;s who this is built for: someone preparing for the IELTS
            speaking test, someone about to sit through an English interview,
            or just someone who&apos;s stopped translating every sentence in
            their head before saying it out loud, over and over in their own
            city, day after day, until it stops feeling like a performance.
          </p>

          <div className="mt-6 rounded-2xl border-2 border-[#7ED856]/70 bg-cream/40 p-5">
            <p className="font-display text-base italic text-ink">
              Not a classroom you sit through once. A room you keep coming
              back to, until speaking English stops needing courage.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", x: 120, rotate: 3 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, rotate: 0 }}
          viewport={{ once: false }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="group relative"
        >
          <div className="absolute -top-5 -right-5 -z-10 h-full w-full rounded-[2rem] bg-[#7ED856] transition-transform duration-300 ease-out group-hover:translate-x-2 group-hover:-translate-y-2" />
          <div
            className="relative h-[320px] w-full overflow-hidden rounded-[2rem] bg-gradient-to-br from-leaf-100 via-cream-soft to-leaf-100/40 shadow-[0_1px_0_0_rgba(21,23,15,0.04)] transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_28px_55px_-12px_rgba(63,122,42,0.5)] md:h-[380px]"
            style={{
              WebkitMaskImage:
                "radial-gradient(ellipse 78% 78% at 50% 50%, black 60%, transparent 100%)",
              maskImage:
                "radial-gradient(ellipse 78% 78% at 50% 50%, black 60%, transparent 100%)",
            }}
          >
            <Image
              src="/philosophy-photo.jpg"
              alt="Members of LingoCraft's daily English speaking club practicing together"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#7ED856]/60 via-[#7ED856]/15 to-transparent mix-blend-multiply transition-opacity duration-300 group-hover:opacity-50" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
