```markdown
# Graft – Phase Roadmap.md
Project Graft  
Goal Production-readiness scanner for AI-built indie apps
Stack Next.js 15 + Supabase + Claude-3.5 Sonnet + Stripe + Vercel  
Target Launch MVP in 7–14 days (March 2026)  
Revenue Goal $3k–8k MRR in first 90 days  

---

## Phase 0 Setup & Foundations (Day 0–1)

Done when
- Repo created (`shipguard-ai`)
- Basic Next.js 15 + Tailwind + shadcnui boilerplate running
- Supabase project created (auth, postgres, storage)
- Stripe test mode connected
- Plausible analytics added
- GitHub repo connected (for future scans)

Tasks
- Clone from `create-next-app` with TypeScript + App Router
- Set up environment variables (`.env.example`)
- Add basic landing page (hero + “Try free scan” button)
- Create Supabase tables (see schema below)

Supabase Schema (run once)
```sql
create table scans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  repo_url text,
  scan_status text default 'pending',
  overall_score integer,
  report_json jsonb,
  created_at timestamp default now()
);

create table scan_issues (
  id uuid primary key default uuid_generate_v4(),
  scan_id uuid references scans,
  category text, -- security  scalability  monetization  distribution
  severity text, -- critical  high  medium  low
  title text,
  description text,
  fix_suggestion text,
  code_snippet text
);
```

---

## Phase 1 MVP (Days 1–7) – Ship This First!

Launch criteria Users can connect repo → get full 5-guard report → see fix suggestions → upgrade to Pro.

### Core Features (all must be done)
1. One-Click GitHub Scan
   - OAuth connect (Supabase Auth)
   - List user repos → pick one
   - Or upload zip  paste code (for non-GitHub prototypes)

   2. AI Production Readiness Report
    - 5 sections with score 0–100
      - Security
      - Scalability & Reliability
      - Monetization Readiness
      - Distribution & Launch
     - Overall Score + “Why this won’t hit $1k MRR yet”

3. Security (use static + LLM)
   - Exposed keys, CORS, auth holes, prompt injection, dependency CVEs

4. Scalability
   - Missing error tracking, rate limits, logging, DB pooling

5. Monetization (your secret sauce)
   - Stripe integration checklist, pricing page gaps, trial logic, tax setup

6. Distribution
   - Analytics, SEO, ToSPrivacy page, social proof placeholders

7. One-Click Fix Suggestions
   - Copy-paste code snippets + step-by-step guide

8. Scan History Dashboard
   - List of past scans + score trend chart

UI Pages
- `` → Landing (marketing)
- `dashboard` → Protected (scans list + new scan button)
- `scan[id]` → Beautiful interactive report (PDF export button)
- `pricing` → Freemium tiers

Pricing (live from Day 1)
- Free 1 scanmonth
- Pro $19mo Unlimited
- Unlimited $39mo Weekly auto-scans + public share links

Tech Implementation Notes
- Use Anthropic SDK for Claude-3.5-sonnet (system prompt in next file)
- Store full report as JSONB
- Generate PDF with @react-pdfrenderer
- Rate-limit scans (free tier = 1month)

Milestone Deploy to Vercel + tweet first #BuildInPublic thread with real scan of your own repo.

---

## Phase 2 Post-Launch Growth (Days 8–37)

Goal First 100 users + $2k–5k MRR

New Features
- AI Prototype Scanner (paste Figma  Lovable  Cursor prompt → no-code scan)
- Stripe + Supabase + Vercel One-Click Setup Generator
- Public Shareable Report (beautiful link for XIndieHackers)
- Weekly Auto-Scan (cron job every Friday)
- Competitor Benchmark (“Top indie tools score 92+ because…”)
- Churn & Retention Scanner
- Email digest (Resend)

Marketing Automation
- Auto-tweet public report link when user scans
- In-app “Share your score on X” button
- Waitlist → early-bird lifetime deal ($199)

---

## Phase 3 Scale & Agentic (Days 38–90+)

Goal $15k–30k MRR + possible acquisition

Features
- Agentic Auto-Fixer → opens real GitHub PR with fixes (OpenClaw-style)
- TeamAgency mode + white-label reports
- Fix Template Marketplace (community contributions)
- Revenue Predictor (“With these fixes → $2.4k MRR in 90 days” – trained on TrustMRR patterns)
- Integration marketplace (Next.js, T3, ShipFast, etc.)

Monetization Expansions
- Enterprise plan ($99mo)
- Affiliate program (20% recurring for other indie tools)
- One-time audit service ($299)

Exit-Ready
- Full open revenue on TrustMRR
- Public roadmap + GitHub issues
- API for other tools to embed Graft scan

---

## Success Metrics (Track Weekly)

 Phase  Users  MRR  ScansMonth  Retention 
-------------------------------------------
 MVP Launch  50  $1k  200  — 
 End Phase 2  300  $5k  1,200  65% 
 End Phase 3  1,000  $20k  5,000  80% 

---

Next File to Create
- `prompts.md` → Full Claude system prompt for the AI engine
- `landing-copy.md` → Exact marketing text + SEO
- `x-launch-thread.md` → First 10 tweets ready to copy-paste

Command to create this file
```bash
cat  PHASE.md  'EOF'
# paste everything above
EOF
```

You now have the complete phased development plan.  

Ready for the next step  
Reply with
- “Give me prompts.md” (the full Claude system prompt + examples)
- “Give me the database migration SQL”
- “Give me the landing page copy”
- “Give me the exact GitHub OAuth setup code”

Let’s keep shipping. This is going to be huge. 🚀
```

Copy the entire block above into a new file called `PHASE.md` in your repo.  
It’s ready to commit and use as your single source of truth for the entire build.  

Want the next file right now Just say the word.