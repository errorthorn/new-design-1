"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export function Philosophy() {
  return (
    <section id="philosophy" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
        {/* Photo of a member preparing for a live session */}
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", x: -120, rotate: -3 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, rotate: 0 }}
          viewport={{ once: false }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="group relative order-2 md:order-1"
        >
          {/* solid green shape offset behind the photo, peeking out along
              the top and left edges — not a blur glow. On hover it slides
              further out from behind the photo for a subtle "peel apart"
              effect that pairs with the photo's own hover lift. */}
          <div className="absolute -top-3 -left-3 -z-10 h-full w-full rounded-[1.5rem] bg-[#7ED856] transition-transform duration-300 ease-out group-hover:-translate-x-2 group-hover:-translate-y-2 md:-top-5 md:-left-5 md:rounded-[2rem]" />
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
              alt="A member preparing notes for a live speaking session"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            />
            {/* one-sided green wash — strongest at the bottom, fading out
                toward the top so the photo itself stays visible up there.
                On hover it eases back, revealing a bit more of the photo
                instead of the whole image growing/zooming. */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#7ED856]/60 via-[#7ED856]/15 to-transparent mix-blend-multiply transition-opacity duration-300 group-hover:opacity-50" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.4 }}
          className="order-1 md:order-2"
        >
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Why we teach this way
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            You don&apos;t get fluent from another lecture.
          </h2>
          <p className="mt-5 font-body text-base leading-relaxed text-ink-soft">
            Most courses hand you rules and hope they turn into speech later.
            We flip that: you speak first, on a real topic, in a real
            conversation — and the grammar, vocabulary, and pronunciation
            get corrected as they actually come up. That&apos;s also why the
            feedback is personal, not generic — a weekly problem-solving
            class built around what you specifically struggled with, not a
            fixed curriculum everyone sits through.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
