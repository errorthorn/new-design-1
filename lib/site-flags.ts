// lib/site-flags.ts
//
// Full restore instructions, file list and checklist: HIDDEN-FEATURES.md (project root).
//
// One switch for things that are temporarily hidden from the public site. Nothing is deleted: every component,
// page and plan file is still in the project, so turning this back on restores everything exactly as it was.
//
// SHOW_OFFERS_AND_PRICING
//   false -> hidden:  the offer pop-up on the home page, the "Pricing" link in the navbar, the /pricing page
//                     (it redirects to the home page), the "Buy 1 Get 1" question in the FAQ, and the dashboard
//                     "See plans" button. The hero "Join" button goes to sign-up instead of the pricing page.
//   true  -> everything shows again.
export const SHOW_OFFERS_AND_PRICING = false;

// SHOW_PAYMENT_AND_REFERRAL
//   false -> /payment and /dashboard/refer redirect away, and "Refer & Earn" is removed from the dashboard sidebar.
//   true  -> both pages and the sidebar item are back. (The pages/APIs/tables are untouched either way.)
export const SHOW_PAYMENT_AND_REFERRAL = false;

// SHOW_VOCAB_BATTLE_IN_CALL
//   false -> the "Vocab Battle" button inside a Speaking Club practice room is hidden and the room no longer joins the
//            battle-invite channel (so it also saves a Realtime channel per student). The dashboard's own Vocab Battle
//            (/dashboard/vocab-battle) is NOT affected.
//   true  -> in-call battles are back.
export const SHOW_VOCAB_BATTLE_IN_CALL = false;
