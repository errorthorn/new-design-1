import { Navbar } from "@/components/navbar";
import { MasteryPricing } from "@/components/mastery-pricing";
import { Footer } from "@/components/footer";

export const metadata = {
  title: "Pricing — LingoCraft",
  description:
    "Compare LingoCraft's Starter, Pro, and Dedicated plans and pick the Mastery Plan that fits your pace.",
};

export default function PricingPage() {
  return (
    <main className="min-h-screen" style={{ background: "#0A0C08" }}>
      <Navbar />
      <MasteryPricing />
      <Footer />
    </main>
  );
}
