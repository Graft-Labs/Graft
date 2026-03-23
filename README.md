## Graft

Graft is a SaaS readiness scanner that evaluates repositories across security, scalability, monetization and distribution.

## Production hardening checklist

### 1) Enable leaked password protection in Supabase Auth

1. Open Supabase dashboard for your project.
2. Go to `Authentication` -> `Providers` -> `Email`.
3. Enable **Leaked password protection**.
4. Save settings.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

If this toggle is disabled/greyed out on your project plan, keep password hardening using:
- stronger password policy requirements in your auth UI,
- rate limiting on login/reset endpoints,
- email verification + optional MFA,
- regular credential hygiene messaging.

### 2) Configure staged DAST safe probes

Set these env vars in your deployment platform (Vercel + Trigger.dev env sync):

```bash
SHIPGUARD_DAST_STAGING_URL=https://staging.yourapp.com
SHIPGUARD_DAST_AUTH_HEADER=Bearer <staging-token>
```

Notes:
- `SHIPGUARD_DAST_STAGING_URL` should point to a non-production environment.
- `SHIPGUARD_DAST_AUTH_HEADER` is optional but recommended for authenticated probe coverage.

Where to get values:
- `SHIPGUARD_DAST_STAGING_URL`: your staging app URL (for example Vercel preview/staging domain).
- `SHIPGUARD_DAST_AUTH_HEADER`: create a staging-only bearer token/API key accepted by your middleware and set:
  - `Authorization: Bearer <token>`

### 3) Configure optional OSINT provider keys

```bash
SHODAN_API_KEY=<your_shodan_key>
CENSYS_API_ID=<your_censys_api_id>
CENSYS_API_SECRET=<your_censys_api_secret>
```

If these are not set, Graft still runs DNS-based OSINT checks.

Where to get values:
- `SHODAN_API_KEY`: https://account.shodan.io/
- `CENSYS_API_ID` and `CENSYS_API_SECRET`: https://search.censys.io/account/api

### 3.1) Where to put env vars

Set these in both places used by your runtime:

1. Vercel project env vars (for app/API runtime).
2. Trigger.dev project env vars (for `run-scan` worker runtime).

You can also keep local values in `.env.local` for local development.

### 4) Phase toggles

```bash
SHIPGUARD_PHASE_OSINT=false
SHIPGUARD_PHASE_DAST=true
```

Disable any phase by setting the value to `false`.

### 5) Configure support forms (replaces `mailto:` links)

Set these env vars for the Settings -> Support tab actions:

```bash
NEXT_PUBLIC_SUPPORT_FORM_URL=https://tally.so/r/your-support-form
NEXT_PUBLIC_FEATURE_REQUEST_FORM_URL=https://tally.so/r/your-feature-form
```

If either value is empty, the UI shows a hint with the missing variable name.

## Update Supabase email templates

Your default auth email template can be changed in:
`Supabase Dashboard -> Authentication -> Email Templates`

Recommended templates to customize first:
- Confirm signup
- Magic link (if enabled)
- Reset password

Suggested baseline:
- Set brand name to Graft
- Add support contact
- Use your app URL for CTA links
- Keep security messaging concise and clear

Example confirm-signup subject:
`Confirm your Graft account`

Example opening line:
`Welcome to Graft. Confirm your email to start running repository scans.`

## Environment variables

Use `.env.example` as the source of truth for all required and optional variables.

## Getting Started

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
