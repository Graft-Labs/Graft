# Graft - Implementation Plan

## Project Overview
- **Name**: Graft
- **Goal**: Production-readiness scanner for AI-built indie apps
- **Stack**: Next.js 15 + Supabase + OpenRouter + Stripe alternatives + Vercel
- **Target**: MVP launch in 7-14 days

---

## Core Tool Stack (Deterministic Checks)

| Tool | Purpose | Commands |
|------|---------|----------|
| **TruffleHog** | Secret scanning | `npx trufflehog filesystem --json .` |
| **OSV-Scanner** | CVE/vulnerability detection | `npx @osv-scanner/cli -l package-lock.json --format json` |
| **Semgrep** | Security + custom rules (AST-based) | `npx semgrep --config=p/security-audit --json .` |
| **react-doctor** | React/Next.js specific issues | `npx react-doctor@latest --json .` |

**Execution Flow**: Download repo → Run each tool → Aggregate JSON outputs → Feed to AI for explanations/fixes

---

## Guards & Checks

### 1. Security (~90% Tool-Covered)

| Check | Tool | Output |
|-------|------|--------|
| Exposed API keys | TruffleHog | `{file, secret_type, line, verified}` |
| Exposed secrets in .env | TruffleHog | `{file, secret_type, line}` |
| CVE vulnerabilities | OSV-Scanner | `{package, vuln, severity, affected_versions}` |
| CORS misconfiguration | Semgrep | `{rule: "js/cors-wildcard", location, message}` |
| SQL injection risk | Semgrep | `{rule, location, message}` |
| XSS vulnerabilities | Semgrep + react-doctor | `{file, issue, severity}` |
| Auth missing | Semgrep | `{rule, location, message}` |
| Insecure headers | Semgrep | `{rule, location, message}` |

### 2. Scalability & Reliability (~80% Tool-Covered)

| Check | Tool | Output |
|-------|------|--------|
| Error tracking | react-doctor | `{diagnostics: missing error boundary}` |
| Rate limiting | Semgrep | `{rule: rateLimit middleware gaps}` |
| Structured logging | Semgrep | `{rule: "js/no-console-log", location}` |
| Request logging | Semgrep | `{rule, location}` |
| DB connection pooling | react-doctor | `{diagnostics: anti-patterns}` |
| Health check endpoint | Custom (regex) | File pattern match |
| Graceful shutdown | react-doctor | `{diagnostics: process handlers}` |
| Environment config | Custom | File existence check |

### 3. Monetization (~40% Tool-Covered)

| Check | Tool | Output |
|-------|------|--------|
| Stripe installed | Custom (package.json) | File scan |
| Checkout flow | Custom Semgrep rules | `{rule, location, message}` |
| Webhook handler | Custom Semgrep rules | `{rule, location, message}` |
| Pricing page | Custom | File existence + regex |
| Subscription setup | Custom Semgrep rules | `{rule, location}` |
| Trial logic | Custom Semgrep rules | `{rule, location}` |
| Tax handling | Custom Semgrep rules | `{rule, location}` |
| Customer portal | Custom Semgrep rules | `{rule, location}` |
| Multiple price tiers | Custom (AST parse) | ts-morph for 2+ Price |

### 4. Distribution & Launch (~70% Tool-Covered)

| Check | Tool | Output |
|-------|------|--------|
| Analytics installed | Custom | Regex for init calls |
| Analytics initialized | react-doctor | `{diagnostics}` |
| SEO meta tags | Semgrep + react-doctor | `{rule, location}` |
| Sitemap | Custom | File existence |
| Privacy policy | Custom | File existence |
| Terms of Service | Custom | File existence |
| Cookie consent | Semgrep | `{rule, location}` |
| Open Graph tags | Semgrep | `{rule, location}` |
| 404 page | Custom | File pattern match |

---

## AI Integration (No Hallucination)

**Provider**: OpenRouter `openrouter/free` (auto-selects best free model)
**Context**: 200,000 tokens
**Cost**: $0 (with $10 one-time credit for higher rate limits)

**Key Principle**: AI explains real tool outputs, never invents findings.

**Rate Limit Handling**:
```typescript
async function callAI(prompt: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await openrouter.chat.create({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (error) {
      if (error.status === 429 && i < retries - 1) {
        await sleep(1000 * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}
```

**Prompt Structure**:
```
You are Graft. Analyze these tool outputs and provide:
1. Plain-English explanation of each finding
2. Severity assessment (critical/high/medium/low)
3. Fix code snippets
4. Revenue impact estimate

Tool Outputs:
[TruffleHog JSON]
[OSV-Scanner JSON]
[Semgrep JSON]
[react-doctor JSON]
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Backend | Supabase (Auth, Postgres, Storage, Edge Functions) |
| AI | OpenRouter `openrouter/free` with retry logic |
| Payments | Lemon Squeezy (works in India) or skip for MVP |
| Hosting | Vercel |
| Analytics | Plausible (self-checked in scans) |

---

## MVP Features (Priority Order)

1. GitHub OAuth + repo selection
2. Zip upload / code paste
3. Tool execution pipeline (TruffleHog, OSV-Scanner, Semgrep, react-doctor)
4. 4-Section AI Report with scores (0-100)
5. Fix suggestions with copy-paste code
6. Scan history dashboard
7. Freemium gate (1 scan/month free)

---

## Database Schema (Supabase)

```sql
-- users (managed by Supabase Auth)
-- profiles
create table profiles (
  id uuid references auth.users primary key,
  email text,
  is_pro boolean default false,
  scan_count integer default 0,
  last_scan_at timestamp,
  created_at timestamp default now()
);

-- scans
create table scans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles,
  repo_url text,
  scan_status text default 'pending',
  overall_score integer,
  security_score integer,
  scalability_score integer,
  monetization_score integer,
  distribution_score integer,
  report_json jsonb,
  created_at timestamp default now()
);

-- scan_issues
create table scan_issues (
  id uuid primary key default uuid_generate_v4(),
  scan_id uuid references scans,
  guard text,
  category text,
  severity text,
  title text,
  description text,
  fix_suggestion text,
  code_snippet text,
  file_path text,
  line_number integer,
  created_at timestamp default now()
);
```

---

## File Structure

```
shipguard-ai/
├── app/
│   ├── page.tsx                 # Landing page
│   ├── layout.tsx
│   ├── dashboard/
│   │   └── page.tsx            # Protected: scan history
│   ├── scan/
│   │   └── [id]/page.tsx       # Report view
│   ├── api/
│   │   ├── scan/route.ts       # Trigger scan
│   │   ├── auth/route.ts       # GitHub OAuth
│   │   └── webhook/route.ts    # Payment webhook
│   └── pricing/page.tsx
├── components/
│   ├── ui/                     # shadcn components
│   ├── ScanButton.tsx
│   ├── ReportCard.tsx
│   ├── ScoreChart.tsx
│   └── FixSuggestion.tsx
├── lib/
│   ├── tools/
│   │   ├── trufflehog.ts
│   │   ├── osv-scanner.ts
│   │   ├── semgrep.ts
│   │   └── react-doctor.ts
│   ├── ai/
│   │   └── analyzer.ts         # OpenRouter integration
│   ├── db.ts                   # Supabase client
│   └── utils.ts
├── supabase/
│   └── migrations/
├── public/
├── package.json
├── tailwind.config.ts
├── next.config.ts
└── .env.example
```

---

## Implementation Order

### Week 1
1. [ ] Set up Next.js 15 + Tailwind + shadcn/ui
2. [ ] Configure Supabase project + database schema
3. [ ] GitHub OAuth flow
4. [ ] Repo selection / zip upload UI
5. [ ] Tool execution pipeline (all 4 tools)
6. [ ] Basic report display (scores + issues list)

### Week 2
7. [ ] AI integration (OpenRouter for explanations)
8. [ ] Fix suggestions with code snippets
9. [ ] Scan history dashboard
10. [ ] Freemium gate logic
11. [ ] PDF export
12. [ ] Deploy to Vercel

---

## Pricing (India-Friendly)

- **Free**: 1 scan/month
- **Pro**: $19/mo - unlimited scans (use Lemon Squeezy or Razorpay)
- **Lifetime**: $199 (first 100 users)

---

## Success Metrics

| Metric | Month 1 | Month 3 |
|--------|---------|---------|
| Users | 100 | 500 |
| MRR | $1k | $5k |
| Scans/month | 300 | 2,000 |
| Retention | - | 65% |

---

## Notes

- Tools run server-side in Edge Functions or Vercel Serverless
- Parallelize tool execution where possible to meet 90s target
- Cache tool outputs for re-scans
- Start with Next.js/React focus, expand to other stacks later
