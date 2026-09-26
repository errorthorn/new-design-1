"use client";

import { motion } from "framer-motion";
import { MessageCircle, BookOpen, Target, Users2 } from "lucide-react";
import { Card } from "@/components/ui/card";

export function Features() {
  return (
    <section id="features" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto max-w-6xl">
        <div className="max-w-xl">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            What you actually get
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            The weekly rhythm, not a syllabus.
          </h2>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {/* Daily practice — wide card */}
          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", x: -110 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", x: 0 }}
            viewport={{ once: false, margin: "-60px" }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="md:col-span-2"
          >
            <Card className="card-hover-invert-dark flex h-full flex-col justify-between border-leaf-300/60 bg-white md:flex-row md:items-center">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-100">
                  <MessageCircle size={20} className="text-leaf-700" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-ink">
                  Daily practice, scored by AI
                </h3>
                <p className="mt-2 max-w-sm font-body text-sm leading-relaxed text-ink-soft">
                  Log in, get today&apos;s topic, and speak about it live.
                  AI scores your speaking as you go — so you know what to
                  fix today, not two weeks later.
                </p>
              </div>

              {/* small mock "today's topic" chip — visual interest, no real data.
                  chip-static: keeps its own light background + dark text fixed,
                  even while the parent card inverts to dark on hover. */}
              <div className="chip-static mt-6 shrink-0 rounded-2xl border border-leaf-300/60 bg-cream-soft px-5 py-4 md:mt-0 md:ml-6">
                <p className="font-display text-[11px] font-bold uppercase tracking-wider !text-leaf-700">
                  Today&apos;s topic
                </p>
                <p className="mt-1 font-body text-sm font-medium !text-ink">
                  &ldquo;Describe a skill you&apos;d like to learn&rdquo;
                </p>
              </div>
            </Card>
          </motion.div>

          {/* Vocabulary */}
          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", x: 90 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", x: 0 }}
            viewport={{ once: false, margin: "-60px" }}
            transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
          >
            <Card className="card-hover-invert-dark h-full border-leaf-300/60 bg-white">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-100">
                <BookOpen size={20} className="text-leaf-700" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-ink">
                A new vocabulary set, daily
              </h3>
              <p className="mt-2 font-body text-sm leading-relaxed text-ink-soft">
                Each topic comes with its own word list — and you learn it
                by actually using it in conversation, not by memorizing a
                list.
              </p>
            </Card>
          </motion.div>

          {/* Weekly mock test */}
          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", scale: 0.8 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            viewport={{ once: false, margin: "-60px" }}
            transition={{ duration: 0.4, delay: 0.16, ease: "backOut" }}
          >
            <Card className="card-hover-invert-dark h-full border-leaf-300/60 bg-white">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-100">
                <Target size={20} className="text-leaf-700" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-ink">
                A weekly mock test, scored
              </h3>
              <p className="mt-2 font-body text-sm leading-relaxed text-ink-soft">
                A real speaking mock test every week — with a band score and
                personalized feedback, so you always know exactly where you
                stand.
              </p>
            </Card>
          </motion.div>

          {/* Problem-solving class — wide card */}
          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", x: -110 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", x: 0 }}
            viewport={{ once: false, margin: "-60px" }}
            transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
            className="md:col-span-2"
          >
            <Card className="card-hover-invert-dark h-full border-leaf-300/60 bg-white">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-100">
                <Users2 size={20} className="text-leaf-700" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-ink">
                A live class built around your mistakes
              </h3>
              <p className="mt-2 max-w-md font-body text-sm leading-relaxed text-ink-soft">
                Every week&apos;s mentor class is shaped by what actually
                shows up in your mistake log that week — grammar,
                vocabulary, pronunciation, or just running out of things to
                say.
              </p>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
