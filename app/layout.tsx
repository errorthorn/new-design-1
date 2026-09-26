import type { Metadata, Viewport } from "next";
import { Lora, Poppins } from "next/font/google";
import "./globals.css";
import { AuthWelcomeWatcher } from "@/components/auth-welcome-watcher";

// Brand display face — used sitewide via the `font-display` Tailwind
// class and the `--font-display` CSS variable (globals.css).
const lora = Lora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
});

// Brand body face — used sitewide via the `font-body` Tailwind class
// and the `--font-body` CSS variable (globals.css).
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LingoCraft",
  description:
    "Join LingoCraft's virtual speaking club and build real English speaking confidence through live practice, not just lessons.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${lora.variable} ${poppins.variable}`}
    >
      <body>
        {children}
        {/* Global, so ?welcome=1 shows the post-login/signup congrats
            modal no matter which page someone lands on — see
            lib/welcome-redirect.ts for who sets that marker. */}
        <AuthWelcomeWatcher />
      </body>
    </html>
  );
}
