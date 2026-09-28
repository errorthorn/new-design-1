import { Navbar } from "@/components/navbar";
import { AboutStory } from "@/components/about-story";
import { AboutCommunity } from "@/components/about-community";
import { Footer } from "@/components/footer";

export const metadata = {
  title: "About Us — LingoCraft",
  description:
    "The story behind LingoCraft's daily virtual English speaking club — why it started, and who it's really built for.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <Navbar />
      <AboutStory />
      <AboutCommunity />
      <Footer />
    </main>
  );
}
