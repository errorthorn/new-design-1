# Temporarily hidden features: how to restore them

**Status (set 8 Nov 2026):** the offer pop-up, public pricing, the payment page and Refer & Earn are hidden from
the website. **Nothing was deleted.** Every page, component, API route and database table is still in the project.
Hiding is controlled by two on/off switches in a single file, so restoring is a two-line change.

Keep this file. If you hand the project to another developer or an AI assistant, give them this file first.

---

## 1. The switches

File: **`lib/site-flags.ts`**

```ts
export const SHOW_OFFERS_AND_PRICING = false;   // offer pop-up, pricing page, pricing link, offer FAQ, "See plans", hero button
export const SHOW_PAYMENT_AND_REFERRAL = false; // /payment page, /dashboard/refer page, "Refer & Earn" sidebar item
export const SHOW_VOCAB_BATTLE_IN_CALL = false; // "Vocab Battle" button inside a Speaking Club practice room
```

| Switch | `false` (now) | `true` (restored) |
|---|---|---|
| `SHOW_OFFERS_AND_PRICING` | Offer pop-up, Pricing nav link, `/pricing`, offer FAQ item, "See plans" are hidden; hero button goes to `/signup` | All of these show again; hero button goes to `/pricing` |
| `SHOW_PAYMENT_AND_REFERRAL` | `/payment` redirects to `/`; `/dashboard/refer` redirects to `/dashboard`; "Refer & Earn" removed from the sidebar | Both pages and the sidebar item are back |

There is a third switch, `SHOW_VOCAB_BATTLE_IN_CALL` (default `false`): the Vocab Battle button inside a Speaking Club
practice room. The dashboard's own Vocab Battle is not affected. Set it to `true` to bring in-call battles back.

The switches are independent. Typical restore of pricing/payment: set the first two to `true`.

## 2. Restore procedure (do these in order)

1. Open `lib/site-flags.ts`. Change both values to `true`. Save.
2. Commit and deploy (push to the branch Vercel deploys from, or redeploy manually).
3. Run the verification checklist in section 4 on the live site.
4. Review the content that was frozen while hidden (section 5): offer text, prices, end dates.

No database change, no environment variable and no migration is needed for the restore.

## 3. Everything the switches touch

Do not edit these for the restore. They are listed so that nothing is missed when reviewing.

| File | What the switch does there |
|---|---|
| `lib/site-flags.ts` | Defines both switches |
| `app/page.tsx` | Renders `<PromoPopup />` only when `SHOW_OFFERS_AND_PRICING` is true |
| `components/navbar.tsx` | Adds the "Pricing" link only when `SHOW_OFFERS_AND_PRICING` is true |
| `components/hero.tsx` | Join button: `/pricing` when true, `/signup` when false |
| `app/pricing/page.tsx` | `redirect("/")` when `SHOW_OFFERS_AND_PRICING` is false; page body untouched |
| `components/faq.tsx` | Removes the "Buy 1 Get 1" question when false (`ALL_FAQS` is filtered) |
| `components/dashboard/home/home-view.tsx` | Shows the "See plans" button only when true |
| `app/payment/page.tsx` | `redirect("/")` when `SHOW_PAYMENT_AND_REFERRAL` is false; real page is `PaymentPageReal` |
| `app/dashboard/refer/page.tsx` | `redirect("/dashboard")` when false; real page is `ReferPageReal` |
| `app/speaking-club/room/[code]/page.tsx` | Vocab Battle button and battle-invite channel only when `SHOW_VOCAB_BATTLE_IN_CALL` is true |
| `lib/dashboard-nav.ts` | Includes "Refer & Earn" in the sidebar only when true |

Files that were intentionally **not** changed and still contain the content: `components/promo-popup.tsx`,
`components/mastery-pricing.tsx`, `components/pricing.tsx`, `lib/plans.ts`, all of `app/api/payment/*`,
`app/api/referral/*`, `app/admin/payments`, `app/admin/referrals`.

## 4. Verification checklist after restoring

Open the live site in a private/incognito window and confirm:

- [ ] Home page: the offer pop-up appears.
- [ ] Navbar shows "Pricing" and it opens `/pricing` with the plan cards.
- [ ] Hero "Join LingoCraft Speaking Club" button opens `/pricing`.
- [ ] FAQ contains "How does the Buy 1 Get 1 offer on Pro work?"
- [ ] Logged in as a non-member: Dashboard Home, Mock Test card shows "See plans".
- [ ] `/payment` opens the payment form (does not redirect).
- [ ] Dashboard sidebar → Account shows "Refer & Earn" and `/dashboard/refer` opens.
- [ ] A test payment submission reaches `/admin/payments` (use a test account).

## 5. Review before announcing again

The content was frozen while hidden. Check before turning it back on:

- **Offer wording and end date** in `components/promo-popup.tsx` and `lib/plans.ts` (`PLANS.pro.offer`, `offerNote`).
- **Prices** in `lib/plans.ts`.
- **"Buy 1 Get 1" grant logic**: `monthsGrantedForPlan()` in `lib/plans.ts` currently returns 2 months for Pro on every
  approved payment. If the offer has ended, change it back to 1 **before** restoring `/payment`, otherwise every new
  payment still receives double access.
- **Payment instructions** (bKash/Nagad numbers) in `app/payment/page.tsx`.

## 6. While the features are hidden

- **Giving access without payment:** use the group system. `/admin/members` → "Give access to a group": paste emails,
  type a group name, choose Starter or Pro and the number of days. Members carry that group label, shown as a badge
  in the admin panel (Members, Speaking Club attendance, student search). "Switch off this group" removes access for
  the whole group in one click. Accounts that do not exist yet are listed after the run; they must sign up first, then
  the same list can be run again.
- **Seating a group in rooms:** Admin → Speaking Club → "Assign a group" (`/admin/speaking-club/group-assign`).
- **Still visible to non-members:** the "Activate membership" / "Subscribe" buttons inside Mock Test, Vocab Battle,
  Study Materials, Profile and the locked-page card (`components/dashboard/access-gate.tsx`) still link to `/payment`.
  While `SHOW_PAYMENT_AND_REFERRAL` is false that link sends the visitor to the home page. To hide the buttons
  themselves, wrap those links in `SHOW_PAYMENT_AND_REFERRAL &&` (not done yet).
- The `member_group` column on `users` is created automatically on first start (`lib/db.ts`). It stays after the
  restore and is harmless.

## 7. Instruction text to give another developer or AI

> In this Next.js project, the offer pop-up, pricing, payment page and Refer & Earn are hidden using two flags in
> `lib/site-flags.ts` (`SHOW_OFFERS_AND_PRICING`, `SHOW_PAYMENT_AND_REFERRAL`). Nothing was deleted. Read
> `HIDDEN-FEATURES.md` in the project root. Set both flags to `true`, then go through section 4 (verification) and
> section 5 (review) of that file. In particular check `monthsGrantedForPlan()` in `lib/plans.ts` before re-enabling
> payments. Do not delete or rewrite the pricing, payment or referral files; only change the flags unless the
> checklist shows something that does not come back.
