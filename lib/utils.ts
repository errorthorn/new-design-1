import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// "about 3 hours ago" style relative time, matching the wording used
// across community/mistake-log style feeds. Falls back to a short date
// once something is more than a week old, since "about 12 days ago" reads
// worse than just the date at that point.
export function timeAgo(dateString: string): string {
  const then = new Date(dateString).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `about ${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
