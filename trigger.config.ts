import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalFiles, aptGet, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env.local into process.env so the task worker sees them in dev
try {
  const envLocal = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of envLocal.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not present — fine in CI/prod
}

export default defineConfig({
  project: "proj_ldantbfoufyqhgdvgghm",
  dirs: ["./trigger"],
  maxDuration: 600,
  // Set to false so process.cwd() in tasks points to the build dir (/app),
  // which is where additionalFiles are deployed. This matches production behaviour.
  legacyDevProcessCwdBehaviour: false,
  build: {
    extensions: [
      // Ship our custom semgrep YAML rules alongside the task bundle
      additionalFiles({ files: ["./semgrep-rules/**"] }),
      // install git so we can clone repos inside the task container
      aptGet({ packages: ["git"] }),
      // sync env vars from process.env into Trigger.dev cloud on deploy
      syncEnvVars(() => ({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY!,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL!,
      })),
    ],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 5000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
});
