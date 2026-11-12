import { redirect } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { SHOW_OFFERS_AND_PRICING } from "@/lib/site-flags";
import { MasteryPricing } from "@/components/mastery-pricing";
import { Footer } from "@/components/footer";

export const metadata = {
  title: "Pricing — LingoCraft",
  description:
    "Compare LingoCraft's Starter, Pro, and Dedicated plans and pick the Mastery Plan that fits your pace.",
};

export default function PricingPage() {
  // Hidden for now (lib/site-flags.ts). The page itself is untouched: flip the flag and it is back.
  if (!SHOW_OFFERS_AND_PRICING) redirect("/");
  return (
    <main className="min-h-screen" style={{ background: "#0A0C08" }}>
      <Navbar />
      <MasteryPricing />
      <Footer />
    </main>
  );
}
