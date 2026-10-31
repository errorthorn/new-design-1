"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Phone, Mail, Facebook, MessageCircle, Send, Loader2, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_NUMBERS = ["01758594364", "01522126566"];
const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61590912830367";

function formatBdPhone(n: string) {
  // 01758594364 -> +880 1758-594364
  return `+880 ${n.slice(1, 5)}-${n.slice(5)}`;
}

export function ContactContent() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [status, setStatus] = useState<{ text: string; type: "" | "success" | "error" }>({
    text: "",
    type: "",
  });
  const [loading, setLoading] = useState(false);

  function validate() {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Please enter your name.";
    if (!EMAIL_RE.test(email.trim())) next.email = "Please enter a valid email.";
    if (message.trim().length < 10) next.message = "Please write a bit more detail (at least 10 characters).";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ text: "", type: "" });
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), message: message.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ text: data.error || "Could not send message.", type: "error" });
        return;
      }

      setStatus({ text: "Message sent! We'll get in touch soon.", type: "success" });
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
    } catch {
      setStatus({ text: "Could not reach the server. Please try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ===== Header ===== */}
      <section className="relative overflow-hidden px-6 pb-14 pt-16 md:pt-20">
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="relative mx-auto max-w-2xl text-center"
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-pill border border-ink/10 bg-cream-soft px-4 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-leaf-700">
            <MessageCircle size={14} />
            Get In Touch
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink md:text-4xl">
            We&rsquo;d love to hear from you
          </h1>
          <p className="mt-3 font-body text-ink-soft">
            Questions about Speaking Club, the mock test, or anything else — call, message us on
            Facebook, or send a note below.
          </p>
        </motion.div>
      </section>

      {/* ===== Body ===== */}
      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 lg:grid-cols-5">
        {/* Contact info */}
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-5 lg:col-span-2"
        >
          <Card>
            <p className="font-display text-xs font-semibold uppercase tracking-wider text-leaf-700">
              Call Us
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
              {PHONE_NUMBERS.map((n) => (
                <a
                  key={n}
                  href={`tel:+880${n.slice(1)}`}
                  className="flex items-center gap-2.5 font-body text-[15px] font-medium text-ink transition-colors hover:text-leaf-700"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-leaf-600 bg-white text-leaf-700">
                    <Phone size={15} />
                  </span>
                  {formatBdPhone(n)}
                </a>
              ))}
            </div>
          </Card>

          <Card>
            <p className="font-display text-xs font-semibold uppercase tracking-wider text-leaf-700">
              Message Us
            </p>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-2.5 font-body text-[15px] font-medium text-ink transition-colors hover:text-leaf-700"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-leaf-600 bg-white text-leaf-700">
                <Facebook size={15} />
              </span>
              LingoCraft on Facebook
            </a>
          </Card>

          <Card>
            <p className="font-display text-xs font-semibold uppercase tracking-wider text-leaf-700">
              Email
            </p>
            <a
              href="mailto:info@lingocraft.org"
              className="mt-3 flex items-center gap-2.5 font-body text-[15px] font-medium text-ink transition-colors hover:text-leaf-700"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-leaf-600 bg-white text-leaf-700">
                <Mail size={15} />
              </span>
              info@lingocraft.org
            </a>
          </Card>
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, filter: "blur(8px)", y: 16 }}
          whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="lg:col-span-3"
        >
          <Card>
            <h2 className="font-display text-lg font-bold text-ink">Send a message</h2>
            <p className="mt-1 font-body text-sm text-ink-soft">
              Fill this in and we&rsquo;ll get back to you by email or phone.
            </p>

            <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="mb-1.5 block font-body text-sm font-medium text-ink">
                    Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setErrors((er) => ({ ...er, name: undefined }));
                    }}
                    className="focus-ring w-full rounded-xl border border-ink/15 bg-cream-soft px-4 py-2.5 font-body text-[15px] text-ink placeholder:text-ink-soft/50"
                    placeholder="Your name"
                  />
                  {errors.name && <p className="mt-1 font-body text-xs text-red-600">{errors.name}</p>}
                </div>

                <div>
                  <label htmlFor="phone" className="mb-1.5 block font-body text-sm font-medium text-ink">
                    Phone <span className="text-ink-soft/60">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="focus-ring w-full rounded-xl border border-ink/15 bg-cream-soft px-4 py-2.5 font-body text-[15px] text-ink placeholder:text-ink-soft/50"
                    placeholder="01XXXXXXXXX"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="mb-1.5 block font-body text-sm font-medium text-ink">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors((er) => ({ ...er, email: undefined }));
                  }}
                  className="focus-ring w-full rounded-xl border border-ink/15 bg-cream-soft px-4 py-2.5 font-body text-[15px] text-ink placeholder:text-ink-soft/50"
                  placeholder="you@example.com"
                />
                {errors.email && <p className="mt-1 font-body text-xs text-red-600">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="message" className="mb-1.5 block font-body text-sm font-medium text-ink">
                  Message
                </label>
                <textarea
                  id="message"
                  rows={5}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setErrors((er) => ({ ...er, message: undefined }));
                  }}
                  className="focus-ring w-full resize-none rounded-xl border border-ink/15 bg-cream-soft px-4 py-2.5 font-body text-[15px] text-ink placeholder:text-ink-soft/50"
                  placeholder="How can we help?"
                />
                {errors.message && <p className="mt-1 font-body text-xs text-red-600">{errors.message}</p>}
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="accent" disabled={loading}>
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : status.type === "success" ? (
                    <Check size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  Send message
                </Button>
                {status.text && (
                  <span
                    className={`font-body text-sm ${
                      status.type === "success" ? "text-leaf-700" : "text-red-600"
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {status.text}
                  </span>
                )}
              </div>
            </form>
          </Card>
        </motion.div>
      </section>

    </>
  );
}
