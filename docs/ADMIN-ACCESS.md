# Admin access for staff (by account)

**What it does.** The owner gives a normal LingoCraft user admin access. That person signs in as usual,
clicks their profile icon, and sees **Admin**. It opens `/admin`, which lists only the sections they
were given. They never paste a key.

> ⚠️ This feature was built twice before and then went missing in later versions. It is now covered by
> tests (`tests/admin-access.test.ts`, "stays wired up"). If `npm test` fails there, something that
> makes **Admin** appear was removed — put it back rather than deleting the test.

## How the owner gives access
1. Run `sql/migrations/2026-10-29-admin-staff-accounts.sql` once in the Supabase SQL editor
   (it is also at the end of `sql/schema.sql`).
2. Open `/admin/staff`, enter the owner key (`ADMIN_SECRET`).
3. Under **Give access to an account** type the person's account email, tick sections, **Give access**.
   - The email must belong to an account that already exists (otherwise: "No LingoCraft account uses
     that email"). This is deliberate: linking an email nobody has registered would let a stranger sign
     up with it first.
4. They sign in → profile menu → **Admin**. Remove or turn off from the same page; it takes effect on
   their next request.

Staff made earlier with an **access key** keep working. Keys are still available under "Or make an
access key" for people without an account.

## What staff can and cannot do
- Sections: Scoring, Questions, Speaking Club, Mock Test, Quiz.
- Everything else (Members, Payments, Referrals, Bug Reports, Study Materials, Testimonials, Classes,
  Class Notes, Vocab Words, **Staff**) is owner-only: those routes call `requireAdmin(req)` with no
  section, so a forgotten route stays locked.
- The account is matched by `users.id` stored in `admin_staff.user_id`, never by email text.

## Where the pieces are
| Piece | File |
| --- | --- |
| Table + migration | `sql/migrations/2026-10-29-admin-staff-accounts.sql`, `sql/schema.sql` |
| Server check (key **or** signed-in account) | `lib/admin-auth.ts` → `requireAdmin`, `findSessionStaff` |
| "Am I staff?" endpoint | `app/api/admin/me/route.ts` |
| Client hook | `hooks/use-admin-access.ts` (`useAdminAccess` for menus, `useAdminSession` for pages) |
| **Admin** in the website profile menu (desktop + mobile menu) | `components/navbar.tsx` |
| **Admin** in the dashboard (sidebar + avatar menu) | `components/dashboard/dashboard-shell.tsx` |
| Admin home | `app/admin/page.tsx` |
| Section pages open without a key | `app/admin/{scoring,questions,speaking-club,mock-test,quiz}/page.tsx` |
| Shared admin frame (sidebar, mobile drawer, "Go to…" search) | `components/admin/admin-shell.tsx` |
| Search box, cards, buttons used by every admin page | `components/admin/ui.tsx` |
| Owner-only page list used by the frame | `components/admin/admin-nav.tsx` |
| Owner page (give / remove access) | `app/admin/staff/page.tsx`, `app/api/admin/staff/route.ts` |

## If "Admin" does not show for someone
1. Migration not run → `/api/admin/me` quietly answers `admin: false`; the server log shows
   `account staff lookup failed`.
2. The staff row is turned off, or has no sections ticked.
3. They are signed in with a different account than the one you linked (check the email on `/admin/staff`).
4. The menu caches the answer for 5 minutes per browser tab; a new tab or sign-in refreshes it.

## Look and feel
Every admin page sits inside `AdminShell` (same palette and fonts as the dashboard: white surfaces, green borders and buttons). Keep pages plain: no explanatory paragraphs, and every list gets a `SearchBox` (`matchesSearch` in `components/admin/ui.tsx`). The test above fails if a staff section loses its frame or search.
