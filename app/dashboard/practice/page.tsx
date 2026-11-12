import { redirect } from "next/navigation";

// "Practice" in the dashboard sidebar now points straight at the real
// Speaking Club feature (/speaking-club — shared with the homepage nav).
// This route is kept only so old links/bookmarks to /dashboard/practice
// land somewhere useful instead of a dead "coming soon" stub.
export default function PracticeRedirectPage() {
  redirect("/speaking-club");
}
