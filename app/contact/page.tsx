import { Navbar } from "@/components/navbar";
import { ContactContent } from "@/components/contact-content";
import { Footer } from "@/components/footer";

export const metadata = {
  title: "Contact Us — LingoCraft",
  description:
    "Get in touch with LingoCraft — call us, message us on Facebook, or send a message directly.",
};

export default function ContactPage() {
  return (
    <main className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <Navbar />
      <ContactContent />
      <Footer />
    </main>
  );
}
