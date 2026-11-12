"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Phone, Mail, MapPin, Facebook, Instagram, Linkedin, Youtube } from "lucide-react";

// href defaults to "#" (placeholder — no page for it yet) unless given.
const columns = [
  {
    title: "Programs",
    links: [
      { label: "Speaking Club" },
      { label: "Beginner Room" },
      { label: "IELTS Speaking Practice" },
      { label: "Corporate Training" },
    ],
  },
  {
    title: "Free Resources",
    links: [
      { label: "Pronunciation Guide" },
      { label: "Common Phrases" },
      { label: "Grammar Basics" },
      { label: "Blog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Success Stories" },
      { label: "Contact", href: "/contact" },
      { label: "Careers" },
    ],
  },
  {
    title: "Quick Links",
    links: [
      { label: "Dashboard", href: "/mock-test" },
      { label: "Book a Session" },
      { label: "Member Login", href: "/login" },
    ],
  },
];

const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61590912830367";

const socials = [
  { icon: Facebook, label: "Facebook", href: FACEBOOK_URL },
  { icon: Instagram, label: "Instagram" },
  { icon: Linkedin, label: "LinkedIn" },
  { icon: Youtube, label: "YouTube" },
];

export function Footer() {
  return (
    <footer className="bg-ink px-6 pt-16 text-cream/80">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 20 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: false, margin: "-40px" }}
          transition={{ duration: 0.4 }}
          className="flex flex-col justify-between gap-10 border-b border-cream/10 pb-10 md:flex-row"
        >
          <div className="max-w-sm">
            <a href="/" className="flex items-center gap-2.5">
              <span className="relative block h-9 w-9 overflow-hidden rounded-full ring-1 ring-cream/20">
                <Image src="/logo.svg" alt="LingoCraft" fill className="object-cover" />
              </span>
              <span className="font-display text-lg font-semibold text-cream">
                LingoCraft
              </span>
            </a>
            <p className="mt-4 font-body text-sm leading-relaxed text-cream/60">
              A live English speaking club built around real conversation, not
              another course you never finish. Show up, speak, and improve
              week over week.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 font-body text-sm sm:grid-cols-3">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-cream/50">
                Call Us
              </p>
              <a href="tel:+8801758594364" className="mt-3 flex items-center gap-2 text-cream/80 transition-colors hover:text-leaf-500">
                <Phone size={15} /> +880 1758-594364
              </a>
              <a href="tel:+8801522126566" className="mt-2 flex items-center gap-2 text-cream/80 transition-colors hover:text-leaf-500">
                <Phone size={15} /> +880 1522-126566
              </a>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-cream/50">
                Email
              </p>
              <a href="mailto:info@lingocraft.org" className="mt-3 flex items-center gap-2 text-cream/80 transition-colors hover:text-leaf-500">
                <Mail size={15} /> info@lingocraft.org
              </a>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-cream/50">
                Location
              </p>
              <p className="mt-3 flex items-start gap-2 text-cream/80">
                <MapPin size={15} className="mt-0.5 shrink-0" />
                Dhaka, Dhaka division, Bangladesh
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-8 py-12 font-body text-sm sm:grid-cols-4">
          {columns.map((col) => (
            <motion.div
              key={col.title}
              initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
              whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              viewport={{ once: false, margin: "-40px" }}
              transition={{ duration: 0.35 }}
            >
              <p className="font-display text-sm font-semibold text-cream">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href || "#"}
                      className="text-cream/60 transition-colors hover:text-leaf-500"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
            whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            viewport={{ once: false, margin: "-40px" }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="col-span-2 flex items-start gap-3 sm:col-span-4 sm:justify-end"
          >
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href || "#"}
                target={s.href ? "_blank" : undefined}
                rel={s.href ? "noopener noreferrer" : undefined}
                aria-label={s.label}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7ED856]/15 text-cream transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#7ED856] hover:text-ink"
              >
                <s.icon size={16} />
              </a>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false, margin: "-20px" }}
          transition={{ duration: 0.35 }}
          className="flex flex-col items-center justify-between gap-3 border-t border-cream/10 py-6 font-body text-xs text-cream/50 sm:flex-row"
        >
          <p>
            © {new Date().getFullYear()} <span className="text-cream/80">LingoCraft</span>. All rights reserved.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-hover-highlight transition-colors hover:text-cream">Privacy Policy</a>
            <a href="#" className="text-hover-highlight transition-colors hover:text-cream">Terms of Service</a>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
