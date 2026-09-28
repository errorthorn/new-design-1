import Link from "next/link";
import { Lock, Mic, Volume2, LogIn, BookOpen, Video, Sparkles, FileText, PlayCircle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

type MaterialItem = {
  id: string;
  title: string;
  body: string | null;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  fileUrl?: string | null;
};

type MaterialBox = {
  id: string;
  title: string;
  type: string;
  items: MaterialItem[];
};

async function getPublishedBoxes(): Promise<MaterialBox[]> {
  const { data: boxes } = await supabaseServer
    .from("material_boxes")
    .select("id, title, type")
    .order("position", { ascending: true });

  const { data: items } = await supabaseServer
    .from("material_items")
    .select("id, box_id, title, body, video_url, file_path, file_name")
    .eq("published", true)
    .order("position", { ascending: true });

  const withSignedUrls: MaterialItem[] = await Promise.all(
    (items ?? []).map(async (item) => {
      if (!item.file_path) return item;
      const { data } = await supabaseServer.storage
        .from("study-materials")
        .createSignedUrl(item.file_path, 60 * 60); // 1 hour
      return { ...item, fileUrl: data?.signedUrl ?? null };
    })
  );

  return (boxes ?? []).map((box) => ({
    ...box,
    items: withSignedUrls.filter((item: any) => item.box_id === box.id),
  }));
}

export default async function StudyMaterialsPage() {
  const user = await getCurrentUser();
  const isMember = Boolean(user?.subscriptionActive);
  const boxes = isMember ? await getPublishedBoxes() : [];

  return (
    <main className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <Navbar />

      {isMember ? <MemberView name={user?.name} boxes={boxes} /> : <LockedView loggedIn={Boolean(user)} />}

      <Footer />
    </main>
  );
}

function LockedView({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
        <div>
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
            Members-only
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            Study materials are a Speaking Club perk.
          </h1>
          <p className="mt-5 font-body text-base leading-relaxed text-ink-soft">
            Members get vocabulary for every daily practice topic, the
            recorded class + slide PDF from each weekly problem-solving
            session, and free resources for speaking practice — all in one
            place. Join the Speaking Club to unlock the full library.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              href="/payment"
              className={cn(buttonVariants({ variant: "accent", size: "lg" }), "gap-2.5")}
            >
              <Mic size={18} />
              Join the Speaking Club
            </Link>
            {!loggedIn && (
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "gap-2")}
              >
                <LogIn size={17} />
                Already a member? Log in
              </Link>
            )}
          </div>
        </div>

        {/* Locked preview card — same sample as the homepage, blurred */}
        <div className="relative">
          <div className="pointer-events-none select-none blur-sm">
            <Card className="border-2 border-[#7ED856] bg-[#7ED856]/10 p-7">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-2xl font-extrabold text-ink">Meticulous</h3>
                <span className="rounded-pill bg-leaf-100 px-3 py-1 font-body text-xs font-semibold text-leaf-700">
                  adjective
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 font-body text-sm text-ink-soft">
                <Volume2 size={15} className="text-leaf-600" />
                /məˈtɪkjələs/
              </div>
              <p className="mt-4 font-body text-sm leading-relaxed text-ink">
                Showing great attention to detail; very careful and precise.
              </p>
            </Card>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 font-body text-sm font-semibold text-cream shadow-lg">
              <Lock size={15} />
              Unlocks after joining
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const BOX_ICONS: Record<string, typeof BookOpen> = {
  vocabulary: BookOpen,
  class: Video,
  resource: Sparkles,
};

const BOX_EMPTY_TEXT: Record<string, string> = {
  vocabulary: "No vocabulary sheet posted yet for today's topic.",
  class: "No class recording or slides posted yet for this week.",
  resource: "Nothing posted here yet — check back soon.",
};

function MemberView({ name, boxes }: { name?: string; boxes: MaterialBox[] }) {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="relative mx-auto max-w-6xl">
        <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
          Member library
        </span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
          {name ? `Welcome back, ${name}.` : "Your study materials"}
        </h1>
        <p className="mt-5 max-w-2xl font-body text-base leading-relaxed text-ink-soft">
          Everything from the club, in one place — updated as each daily
          topic and weekly class happens.
        </p>

        {boxes.length === 0 ? (
          <Card className="mt-10 max-w-md border-dashed border-ink/20 bg-transparent p-8 text-center">
            <p className="font-body text-sm text-ink-soft">Nothing posted yet — check back soon.</p>
          </Card>
        ) : (
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {boxes.map((box) => (
              <MaterialSection key={box.id} box={box} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MaterialSection({ box }: { box: MaterialBox }) {
  const Icon = BOX_ICONS[box.type] ?? BookOpen;

  return (
    <div>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-100">
        <Icon size={20} className="text-leaf-700" />
      </div>
      <h3 className="mt-4 font-display text-base font-semibold text-ink">{box.title}</h3>

      {box.items.length === 0 ? (
        <Card className="mt-5 border-dashed border-ink/20 bg-transparent p-6 text-center">
          <p className="font-body text-xs leading-relaxed text-ink-soft/80">
            {BOX_EMPTY_TEXT[box.type] ?? "Nothing posted here yet — check back soon."}
          </p>
        </Card>
      ) : (
        <div className="mt-5 space-y-4">
          {box.items.map((item) => (
            <Card key={item.id} className="p-5">
              <h4 className="font-display text-sm font-semibold text-ink">{item.title}</h4>
              {item.body && (
                <p className="mt-2 whitespace-pre-line font-body text-sm leading-relaxed text-ink-soft">
                  {item.body}
                </p>
              )}
              {(item.video_url || item.fileUrl) && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {item.video_url && (
                    <a
                      href={item.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-leaf-700 underline"
                    >
                      <PlayCircle size={14} />
                      Watch recorded class
                    </a>
                  )}
                  {item.fileUrl && (
                    <a
                      href={item.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-leaf-700 underline"
                    >
                      <FileText size={14} />
                      {item.file_name ?? "Download PDF"}
                    </a>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
