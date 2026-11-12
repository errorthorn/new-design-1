import { redirect } from "next/navigation";

// This page was renamed to /dashboard/refer once the real Refer & Earn
// feature was built (it used to be a "coming soon" stub). Kept as a
// redirect rather than deleted outright in case anything still links here.
export default function EarnParticleRedirect() {
  redirect("/dashboard/refer");
}
