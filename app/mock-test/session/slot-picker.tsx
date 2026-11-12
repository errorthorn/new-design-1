"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// Two-step slot picker: pick a day on the calendar, then a time from the
// list beside it, then confirm. Nothing is booked until the confirm button
// is pressed (the old picker booked on the first tap of a time).
//
// All grouping happens in the viewer's local time zone — that is what the
// day numbers and clock times should match for whoever is looking — and the
// week starts on Saturday to match the Saturday-to-Friday testing cycle
// used in lib/mock-test-slots.ts.

export type PickerSlot = { slotStart: string; slotEnd: string };

type Props = {
  // Only slots that can actually be booked — the caller filters out full ones.
  slots: PickerSlot[];
  picking: boolean;
  onConfirm: (slotStart: string) => void;
  onCancel: () => void;
};

const WEEKDAYS = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m: m - 1, d };
};
const monthIndex = (v: { y: number; m: number }) => v.y * 12 + v.m;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

const PERIODS = [
  { id: "morning", label: "Morning", test: (h: number) => h < 12 },
  { id: "afternoon", label: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { id: "evening", label: "Evening", test: (h: number) => h >= 17 },
];

export function SlotPicker({ slots, picking, onConfirm, onCancel }: Props) {
  const byDay = useMemo(() => {
    const map = new Map<string, PickerSlot[]>();
    for (const s of slots) {
      const k = dayKey(new Date(s.slotStart));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [slots]);
  const dayKeys = useMemo(() => Array.from(byDay.keys()).sort(), [byDay]);

  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedStart, setPickedStart] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<{ y: number; m: number } | null>(null);

  // The list can refresh underneath the student (someone else takes a slot),
  // so every selection is re-validated against the current options.
  const activeDay = pickedDay && byDay.has(pickedDay) ? pickedDay : dayKeys[0] ?? null;
  const daySlots = activeDay ? byDay.get(activeDay) ?? [] : [];
  const selected = daySlots.find((s) => s.slotStart === pickedStart) ?? null;

  if (!activeDay) return null;

  const first = parseKey(dayKeys[0]);
  const last = parseKey(dayKeys[dayKeys.length - 1]);
  const activeParts = parseKey(activeDay);
  const view = viewMonth ?? { y: activeParts.y, m: activeParts.m };
  const canPrev = monthIndex(view) > monthIndex({ y: first.y, m: first.m });
  const canNext = monthIndex(view) < monthIndex({ y: last.y, m: last.m });

  const shiftMonth = (delta: number) => {
    const idx = monthIndex(view) + delta;
    setViewMonth({ y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 });
  };

  const lead = (new Date(view.y, view.m, 1).getDay() + 1) % 7; // Saturday = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const todayKey = dayKey(new Date());

  const minutes = Math.round(
    (new Date(slots[0].slotEnd).getTime() - new Date(slots[0].slotStart).getTime()) / 60000
  );
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mtp">
      <dl className="mtp-details bn">
        <div>
          <dt>Test</dt>
          <dd>IELTS Speaking mock test</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{minutes} minutes</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{timeZone.replace(/_/g, " ")}</dd>
        </div>
      </dl>

      <div className="mtp-body">
        <div className="mtp-cal">
          <div className="mtp-cal-head">
            <button
              type="button"
              className="mtp-nav"
              onClick={() => shiftMonth(-1)}
              disabled={!canPrev}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="mtp-month bn" aria-live="polite">
              {monthLabel}
            </span>
            <button
              type="button"
              className="mtp-nav"
              onClick={() => shiftMonth(1)}
              disabled={!canNext}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mtp-grid mtp-weekdays bn" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mtp-grid">
            {cells.map((day, i) => {
              if (day === null) return <span key={`lead-${i}`} />;
              const key = `${view.y}-${pad(view.m + 1)}-${pad(day)}`;
              const available = byDay.has(key);
              const isSelected = key === activeDay;
              const cls = [
                "mtp-day",
                "bn",
                available ? "mtp-day-on" : "mtp-day-off",
                isSelected ? "mtp-day-selected" : "",
                key === todayKey ? "mtp-day-today" : "",
              ]
                .filter(Boolean)
                .join(" ");
              if (!available) {
                return (
                  <span key={key} className={cls}>
                    {day}
                  </span>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  aria-pressed={isSelected}
                  aria-label={new Date(view.y, view.m, day).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  onClick={() => {
                    setPickedDay(key);
                    setPickedStart(null);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mtp-legend bn">
            <span>
              <i className="mtp-dot mtp-dot-on" />
              Available
            </span>
            <span>
              <i className="mtp-dot mtp-dot-off" />
              Not available
            </span>
            <span>
              <i className="mtp-dot mtp-dot-sel" />
              Selected
            </span>
          </div>
        </div>

        <div className="mtp-times">
          <p className="mtp-times-title bn">
            {new Date(activeParts.y, activeParts.m, activeParts.d).toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
          <div className="mtp-times-scroll" role="group" aria-label="Available times">
            {PERIODS.map((period) => {
              const inPeriod = daySlots.filter((s) => period.test(new Date(s.slotStart).getHours()));
              if (inPeriod.length === 0) return null;
              return (
                <div key={period.id}>
                  <p className="mtp-period bn">{period.label}</p>
                  {inPeriod.map((s) => {
                    const isSel = s.slotStart === selected?.slotStart;
                    return (
                      <button
                        key={s.slotStart}
                        type="button"
                        className={`mtp-time bn${isSel ? " mtp-time-selected" : ""}`}
                        aria-pressed={isSel}
                        disabled={picking}
                        onClick={() => setPickedStart(s.slotStart)}
                      >
                        <span>
                          {fmtTime(s.slotStart)} – {fmtTime(s.slotEnd)}
                        </span>
                        {isSel && <Check size={16} strokeWidth={2.5} />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mtp-foot">
        <button type="button" className="mt-btn mt-ghost" onClick={onCancel} disabled={picking}>
          Cancel
        </button>
        <p className="mtp-summary bn" aria-live="polite">
          {selected
            ? `${new Date(selected.slotStart).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}, ${fmtTime(selected.slotStart)}`
            : "Pick a day, then a time"}
        </p>
        <button
          type="button"
          className={`mt-btn mt-primary${!selected || picking ? " mt-disabled" : ""}`}
          disabled={!selected || picking}
          onClick={() => selected && onConfirm(selected.slotStart)}
        >
          {picking ? <Loader2 size={14} className="mtp-spin" /> : null}
          {picking ? "Booking…" : "Book this slot"}
        </button>
      </div>
    </div>
  );
}
