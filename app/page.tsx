import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { Showcase } from "@/components/showcase";
import { HowItWorks } from "@/components/how-it-works";
import { Philosophy } from "@/components/philosophy";
import { MembershipJourney } from "@/components/membership-journey";
import { VocabularySample } from "@/components/vocabulary-sample";
import { Testimonials } from "@/components/testimonials";
import { MembershipHighlights } from "@/components/membership-highlights";
import { FAQ } from "@/components/faq";
import { Footer } from "@/components/footer";
import { PromoPopup } from "@/components/promo-popup";
import { SHOW_OFFERS_AND_PRICING } from "@/lib/site-flags";

export default function Home() {
  return (
    <main>
      {SHOW_OFFERS_AND_PRICING && <PromoPopup />}
      <Navbar />
      <Hero />
      <Showcase />
      <HowItWorks />
      <Philosophy />
      <MembershipJourney />
      <VocabularySample />
      <Testimonials />
      <MembershipHighlights />
      <FAQ />
      <Footer />
    </main>
  );
}
