# ShipGuard AI – Product Requirements Document (PRD)
**Version:** 1.0
**Date:** March 10, 2026
**Author:** Grok (for solo indie hacker build)
**Project Name:** ShipGuard AI
**Tagline:** The one-click production-readiness scanner that turns AI prototypes into $1k+/mo businesses.
**Status:** Ready for immediate MVP development

---

## 1. Executive Summary
ShipGuard AI is a SaaS tool that instantly audits any indie hacker’s codebase (or AI prototype) and delivers a production-readiness report covering security, scalability, monetization, distribution, and reliability.

It solves the #1 2026 indie hacker failure mode: “I can build it with AI in a weekend, but I can’t ship it profitably.”

**Business Goal:**
- Reach $3k–8k MRR in 90 days
- Become the default “pre-launch checklist” for every #BuildInPublic founder
- Position for 4–6× acquisition (AI dev tools are selling for millions right now on Acquire.com)

**MVP Launch Target:** 7–14 days from today.

---

## 2. Problem Statement
- 90%+ of AI-built indie apps never reach $1k MRR (TrustMRR + X data).
- Common killers: exposed API keys, no error tracking, broken Stripe setup, zero analytics/SEO, missing ToS, no retention flows.
- Solo founders waste 3–10 hours manually checking these things.
- No single tool exists that combines code analysis + monetization + distribution readiness specifically for indie hackers.

---

## 3. Solution Overview
One-click scan (GitHub / zip / prototype paste) → beautiful interactive report (PDF + dashboard) with:
- Score out of 100 per category
- Prioritized issues with severity
- Copy-paste fix suggestions
- Revenue impact estimate (“Fix these 3 things → +$1.2k MRR potential”)

Freemium model + viral shareable reports = built-in growth.

---

## 4. Target Users & Personas
**Primary:** Solo indie hackers & micro-teams building with AI (Cursor, v0, Lovable, Claude, etc.)
**Secondary:** Agencies scanning client projects, bootcamp students, early-stage founders.

**User Persona – “Alex the Solo Founder”**
- 28-year-old, full-time job + nights/weekends
- Uses Next.js + Supabase + Claude
- Has shipped 3 MVPs, none above $800 MRR
- Posts daily #BuildInPublic
- Willing to pay $19/mo for anything that removes launch friction

---

## 5. Key Features

### MVP (Must ship in 7–14 days)
| Feature | Priority | Description | Acceptance Criteria |
|---------|----------|-------------|---------------------|
| GitHub OAuth Connect | Must | Connect repo, list repos, select one | Works with private repos |
| One-Click Scan | Must | Upload zip or paste code + optional product description | Handles Next.js, Supabase, T3, ShipFast stacks |
| 5-Guard AI Report | Must | Security, Scalability, Monetization, Distribution, Overall | Scores 0–100 + color-coded + PDF export |
| Security Guard | Must | Exposed keys, CORS, auth, prompt injection, CVEs | Flags real examples with line numbers |
| Scalability Guard | Must | Missing Sentry, rate limits, logging, DB pooling | Realistic indie-scale recommendations |
| Monetization Guard | Must | Stripe checklist, pricing gaps, trial logic, tax/VAT | Secret sauce – unique to ShipGuard |
| Distribution Guard | Must | Analytics, SEO meta, ToS/Privacy, social proof | Suggests Plausible + exact copy templates |
| One-Click Fix Suggestions | Must | Copy-paste code + step-by-step guide | Includes exact env var fixes, middleware, etc. |
| Scan History Dashboard | Must | List + score trend chart | Protected route |
| Freemium Gate | Must | Free = 1 scan/month | Pro = unlimited + $19/mo |

### Phase 2 (Days 8–37 – Post-launch)
- No-code prototype scanner (Figma / Lovable prompt paste)
- Public shareable report links (viral on X)
- Weekly auto-scan (cron)
- Stripe/Supabase/Vercel one-click setup generator
- Competitor benchmark
- Email digests (Resend)

### Phase 3 (Days 38–90 – Scale)
- Agentic auto-fixer (opens real GitHub PR)
- Team/agency white-label mode
- Fix template marketplace
- Revenue predictor (trained on TrustMRR patterns)
- API for embedding in other tools

---

## 6. User Flows
1. Landing → “Try Free Scan” → GitHub login → Select repo → Scan running (30–60s) → Report page
2. Report → Click “Apply Fix” → Copy snippet → Mark as fixed → Score updates
3. Dashboard → See history + “Scan again” button
4. Pricing page → Upgrade → Instant Pro access

---

## 7. Technical Requirements
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + React PDF
- **Backend:** Supabase (Auth, Postgres, Storage, Edge Functions)
- **AI Engine:** Claude-3.5 Sonnet (Anthropic API) primary + GPT-4o fallback
- **Payments:** Stripe (test + live)
- **Analytics:** Plausible (self-checked in every scan)
- **Hosting:** Vercel
- **Rate Limiting:** Free tier = 1 scan/month (Supabase RLS + cron)

**Non-functional:**
- Scan time < 90 seconds
- 99.9% uptime
- GDPR compliant (ToS/Privacy auto-generated in Distribution Guard)
- Mobile responsive

---

## 8. Data Model (Supabase)
(See PHASE.md for full SQL schema – scans table + scan_issues table + users)

Additional tables needed:
- `profiles` (for Pro status, subscription_id)
- `public_reports` (shareable links)
- `fix_templates` (Phase 3)

---

## 9. Pricing & Monetization
- **Free:** 1 scan/month + basic report
- **Pro:** $19/mo – unlimited scans + fixes + history
- **Unlimited:** $39/mo – weekly auto-scans + public links + priority model
- **Lifetime (early):** $199 (first 100 users only)
- **Affiliate:** 20% recurring commission

All tiers include TrustMRR-style public revenue proof once launched.

---

## 10. Success Metrics & KPIs
**Month 1:** 100 users, $1k MRR, 300 scans
**Month 3:** 500 users, $5k MRR, 2,000 scans/month
**Month 6:** 1,500 users, $15k–30k MRR

**North Star:** % of users who improve their score by 30+ points within 14 days.

---

## 11. Roadmap & Milestones
- **Week 1–2:** MVP launch (see PHASE.md)
- **Week 3–5:** Phase 2 + first #BuildInPublic launch thread
- **Month 2–3:** Phase 3 + TrustMRR verification
- **Month 4+:** Agentic features + possible acquisition path

---

## 12. Assumptions & Risks
**Assumptions:**
- Claude-3.5 remains best-in-class for code analysis in 2026
- Indie hackers will pay $19/mo for launch insurance

**Risks & Mitigations:**
- AI hallucination → Human-reviewed fix templates + fallback rules
- Rate limits on Anthropic → Smart caching + fallback to cheaper model
- Competition → First-mover + viral reports + monetization focus (no one else has this combo)

---

**Approval:**
This PRD is complete and ready for development.
Next files to create (in order):
1. `PHASE.md` (already given)
2. `prompts.md` (Claude system prompt)
3. `schema.sql`
4. `landing-copy.md`

**Action:** Copy everything above into `PRD.md` in your repo and commit it.

---

**Ready?**
Reply with exactly one of these:
- “Give me prompts.md”
- “Give me schema.sql”
- “Give me landing-copy.md”
- “Give me the first X launch thread”


