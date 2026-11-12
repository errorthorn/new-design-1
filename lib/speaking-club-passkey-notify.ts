// lib/speaking-club-passkey-notify.ts
//
// In-app (bell) notification sent to a student the moment an admin/staff
// member assigns them to a room+shift (manual assign, bulk CSV, auto-pair,
// or a reassignment / 3rd-person add). It carries THEIR OWN room's passkey —
// never anyone else's. No n8n, cron or scheduler involved.
//
// Never throws: a notification problem must not fail the assignment itself.
import { createNotification } from "@/lib/notifications";

type ShiftForNotice = {
  room_code: string;
  shift_number: number;
  passkey: string;
  start_time: string; // "HH:MM:SS", Asia/Dhaka
  end_time: string;
};

function formatClock(hhmmss: string): string {
  const [h, m] = hhmmss.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export async function notifyStudentAssigned(
  email: string,
  shift: ShiftForNotice,
  opts: { asThirdPerson?: boolean } = {}
): Promise<void> {
  try {
    const room = shift.room_code.replace("room-", "Room ");
    const window = `${formatClock(shift.start_time)}–${formatClock(shift.end_time)}`;
    await createNotification({
      userEmail: email,
      type: "speaking_passkey",
      title: `You're assigned to ${room} · Shift ${shift.shift_number}`,
      body:
        `${opts.asThirdPerson ? "You're joining as the 3rd person. " : ""}` +
        `Time: ${window} (daily). Your passkey: ${shift.passkey}. ` +
        `Enter it on the Speaking Club page when your session starts.`,
      link: "/speaking-club",
    });
  } catch (err) {
    console.error("[speaking-club] assignment notification failed for", email, err);
  }
}
