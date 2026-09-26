"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Swords,
  ClipboardList,
  CalendarCheck,
  MessagesSquare,
} from "lucide-react";

const ecosystem = [
  {
    tag: "Compete",
    title: "Vocab Battle",
    body: "Head-to-head vocabulary rounds against other learners. Same words from your daily sets, tested under pressure.",
    stat1: { label: "Format", value: "1v1" },
    stat2: { label: "Words from", value: "Daily sets" },
    href: "/dashboard/vocab-battle",
    icon: Swords,
  },
  {
    tag: "Track",
    title: "Mistake Log",
    body: "Every recurring error from your sessions and mock tests, tracked automatically — nothing gets forgotten by next week.",
    stat1: { label: "Logged", value: "Automatically" },
    stat2: { label: "Source", value: "Sessions + tests" },
    href: "/dashboard/mistake-log",
    icon: ClipboardList,
  },
  {
    tag: "Plan",
    title: "Study Planner",
    body: "A weekly plan built around your actual schedule, not a generic calendar everyone gets handed on day one.",
    stat1: { label: "Built for", value: "Your schedule" },
    stat2: { label: "Refreshed", value: "Weekly" },
    href: "/dashboard/study-planner",
    icon: CalendarCheck,
  },
  {
    tag: "Connect",
    title: "Community",
    body: "Ask a question, get an answer from another member or a mentor — no waiting for the next live class to bring it up.",
    stat1: { label: "Answered by", value: "Peers + mentors" },
    stat2: { label: "Wait time", value: "None" },
    href: "/dashboard/community",
    icon: MessagesSquare,
  },
];

export function MembershipJourney() {
  return (
    <section id="membership" className="relative overflow-hidden bg-cream px-6 py-20 md:py-28">
      <div className="relative mx-auto max-w-6xl">
        <div className="max-w-xl">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Beyond the classroom
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            Everything that keeps you consistent.
          </h2>
        </div>

        <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-16">
          {/* single sticky visual on the left */}
          <div className="md:sticky md:top-24 md:self-start">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-ink/10">
              <Image
                src="/journey-performance-tracking.jpg"
                alt="A member checking their performance dashboard on a laptop"
                fill
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-ink/0 to-transparent" />
              <p className="absolute bottom-5 left-5 right-5 font-display text-xl font-bold text-cream">
                Four tools, one membership.
              </p>
            </div>
          </div>

          {/* list of features on the right */}
          <div className="divide-y divide-ink/10">
            {ecosystem.map((item, i) => (
              <motion.a
                key={item.title}
                href={item.href}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.06, ease: "backOut" }}
                className="group flex gap-4 py-6 first:pt-0"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-leaf-600 bg-white text-leaf-700">
                  <item.icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-leaf-600">
                    {item.tag}
                  </span>
                  <h3 className="mt-0.5 font-display text-lg font-bold text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-1 font-body text-sm leading-relaxed text-ink-soft">
                    {item.body}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
                    <span className="font-body text-xs text-ink-soft/80">
                      <span className="font-semibold text-ink">{item.stat1.value}</span> {item.stat1.label.toLowerCase()}
                    </span>
                    <span className="font-body text-xs text-ink-soft/80">
                      <span className="font-semibold text-ink">{item.stat2.value}</span> {item.stat2.label.toLowerCase()}
                    </span>
                    <span className="ml-auto flex items-center gap-1 font-display text-xs font-bold uppercase tracking-wider text-ink transition-colors group-hover:text-leaf-600">
                      Open
                      <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </motion.a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
