"use client";

import { motion } from "framer-motion";
import { Volume2, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function VocabularySample() {
  return (
    <section id="materials" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.4 }}
        >
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Free study materials
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            Vocabulary sheets built to actually stick.
          </h2>
          <p className="mt-5 font-body text-base leading-relaxed text-ink-soft">
            Every word comes with its pronunciation, meaning, and part of
            speech — plus two example sentences and two synonyms, explained
            in Bangla so nothing gets lost in translation. This is a sample
            of exactly what members get every week, for every topic.
          </p>
          <a
            href="https://www.facebook.com/share/p/1DmFBtSqh1/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "accent", size: "lg" }), "mt-7 gap-2.5")}
          >
            <Download size={18} />
            Get a Free Sample Sheet
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", x: 120 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", x: 0 }}
          viewport={{ once: false, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="hover-lift rounded-[1.75rem] border-2 border-[#7ED856] bg-[#7ED856]/10 p-7 shadow-[0_1px_0_0_rgba(21,23,15,0.04)] transition-shadow duration-300 hover:shadow-[0_20px_45px_-12px_rgba(63,122,42,0.25)]"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-2xl font-extrabold text-ink">
              Meticulous
            </h3>
            <span className="rounded-pill bg-leaf-100 px-3 py-1 font-body text-xs font-semibold text-leaf-700">
              adjective
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2 font-body text-sm text-ink-soft">
            <Volume2 size={15} className="text-leaf-600" />
            /məˈtɪkjələs/
          </div>

          <p className="mt-4 font-body text-sm leading-relaxed text-ink">
            Showing great attention to detail; very careful and precise.
          </p>

          <div className="mt-5 border-t border-ink/10 pt-4">
            <p className="font-display text-[11px] font-bold uppercase tracking-wider text-leaf-600">
              Examples
            </p>
            <p className="mt-2 font-body text-sm text-ink-soft">
              She kept a <strong className="text-ink">meticulous</strong> record of every expense.
              <br />
              <span className="text-ink-soft/70">
                সে প্রতিটি খরচের নিখুঁত হিসাব রাখত।
              </span>
            </p>
            <p className="mt-3 font-body text-sm text-ink-soft">
              His <strong className="text-ink">meticulous</strong> planning made the event flawless.
              <br />
              <span className="text-ink-soft/70">
                তার নিখুঁত পরিকল্পনার কারণে অনুষ্ঠানটি নির্ভুল হয়েছিল।
              </span>
            </p>
          </div>

          <div className="mt-5 border-t border-ink/10 pt-4">
            <p className="font-display text-[11px] font-bold uppercase tracking-wider text-leaf-600">
              Synonyms
            </p>
            <div className="mt-2 flex gap-2">
              <span className="rounded-pill bg-cream-deep px-3 py-1 font-body text-xs text-ink-soft">
                Careful
              </span>
              <span className="rounded-pill bg-cream-deep px-3 py-1 font-body text-xs text-ink-soft">
                Precise
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
