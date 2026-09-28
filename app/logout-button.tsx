"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={loading}
      aria-label={loading ? "Logging out" : "Log out"}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
      <span className="hidden sm:inline">{loading ? "Logging out…" : "Log out"}</span>
    </Button>
  );
}
