"use client";

import Image from "next/image";
import { motion } from "framer-motion";

type ShowcaseItem = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  photo: string; // drop the real photo into /public with this filename
  alt: string;
  tag: string; // short floating label on the photo, e.g. "Live now"
};

// TODO: replace each `photo` path with a real photo dropped into /public.
// Until then Next/Image will 404 on these — swap the filenames once you
// have the shots, no code changes needed.
const items: ShowcaseItem[] = [
  {
    id: "conversation",
    eyebrow: "Not vocabulary drills — actual conversation",
    title: "Say something worth arguing about.",
    body: "Every day comes with one topic and the words you'll need for it, handed to you beforehand. Then you get on a call and actually use them — for an hour, with real people, on a real subject. No small talk to hide behind.",
    photo: "/showcase-conversation.jpg",
    alt: "Members in a live video call discussing a daily topic",
    tag: "Live session",
  },
  {
    id: "global",
    eyebrow: "Practice partners from all walks of life",
    title: "Learn to understand English that isn't scripted.",
    body: "Every session puts you across the screen from someone who didn't learn English the same way you did. Different accents, different pace, different slang — the kind you'll actually run into outside a classroom.",
    photo: "/showcase-global.jpg",
    alt: "Members in a group video call practicing spoken English together",
    tag: "Global partners",
  },
  {
    id: "mock-test",
    eyebrow: "Scored by a mentor, not a script",
    title: "You'll know your band score. You'll know why.",
    body: "Your weekly mock test is scored by a real expert mentor, who gives you a band score plus feedback that names exactly what held you back. That week's problem-solving class is then built around it — grammar, vocabulary, pronunciation, or just running out of things to say — with the mentor working through it with you.",
    photo: "/showcase-mocktest.jpg",
    alt: "A mentor giving personalized feedback after a mock speaking test",
    tag: "Weekly mock test",
  },
];

export function Showcase() {
  return (
    <section id="showcase" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl space-y-24 md:space-y-32">
        {items.map((item, i) => {
          const photoFirst = i % 2 === 0;

          return (
            <div
              key={item.id}
              className="relative grid items-center gap-14 md:grid-cols-2"
            >
              <motion.div
                initial={{
                  opacity: 0,
                  filter: "blur(8px)",
                  x: photoFirst ? -120 : 120,
                  rotate: photoFirst ? -3 : 3,
                }}
                whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, rotate: 0 }}
                viewport={{ once: false, margin: "-80px" }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className={
                  "group relative order-2 " +
                  (photoFirst ? "md:order-1" : "md:order-2")
                }
              >
                {/* clean bordered frame, deliberately distinct from the
                    green-blob + radial-mask treatment used for the single
                    narrative photos in Philosophy / About-Community —
                    this section shows 4 photos in a row, so a lighter,
                    UI-card-like frame keeps it from feeling repetitive. */}
                <div className="relative h-[300px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-cream-soft shadow-[0_15px_35px_-18px_rgba(21,23,15,0.25)] transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_25px_50px_-15px_rgba(21,23,15,0.32)] md:h-[360px]">
                  <Image
                    src={item.photo}
                    alt={item.alt}
                    fill
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                  {/* bottom gradient — just enough to keep the tag chip
                      legible over any photo, not a full color wash */}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink/70 to-transparent" />
                  <span className="absolute bottom-4 left-4 rounded-full bg-white/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-cream backdrop-blur-sm">
                    {item.tag}
                  </span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
                whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                viewport={{ once: false, margin: "-80px" }}
                transition={{ duration: 0.4 }}
                className={
                  "order-1 " + (photoFirst ? "md:order-2" : "md:order-1")
                }
              >
                <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
                  {item.eyebrow}
                </span>
                <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
                  {item.title}
                </h2>
                <p className="mt-5 font-body text-base leading-relaxed text-ink-soft">
                  {item.body}
                </p>
              </motion.div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
