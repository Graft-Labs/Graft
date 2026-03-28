import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk/v3";
import type { runScanTask } from "@/trigger/run-scan";
import { captureServerEvent } from "@/lib/posthog-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ScanPayload {
  repo: string;
  branch?: string;
  framework?: string;
}

function logScan(stage: string, meta: Record<string, unknown>) {
  console.log(`[scan-api] ${stage}`, meta);
}

export async function POST(request: NextRequest) {
  const traceId = randomUUID();

  try {
    logScan("start", { traceId });
    await captureServerEvent("anonymous", "scan_api_requested", { traceId });

    // Use getUser() (secure — verifies JWT with Supabase server) instead of getSession()
    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      logScan("unauthorized", { traceId });
      await captureServerEvent("anonymous", "scan_api_unauthorized", {
        traceId,
      });
      return NextResponse.json(
        { error: "unauthorized", message: "Please log in to start a scan" },
        { status: 401 },
      );
    }

    // Get session separately only to read provider_token (not for auth)
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const body: ScanPayload = await request.json();
    const { repo, branch = "main", framework } = body;

    logScan("payload_received", {
      traceId,
      userId: user.id,
      repo,
      branch,
      framework,
    });

    if (!repo) {
      logScan("invalid_input", { traceId });
      await captureServerEvent(user.id, "scan_api_invalid_input", { traceId });
      return NextResponse.json(
        { error: "invalid_input", message: "Repository URL is required" },
        { status: 400 },
      );
    }

    const repoUrl = repo.replace(/\.git$/, "");
    const repoParts = repoUrl.split("/");
    const repoOwner = repoParts[repoParts.length - 2];
    const repoName = repoParts[repoParts.length - 1];

    // Resolve GitHub token: prefer the live provider_token from the current session,
    // fall back to the persisted token in the users table (survives session refresh).
    let isPrivate = false;
    let githubToken: string | null = session?.provider_token ?? null;

    if (githubToken) {
      // Persist the fresh token so future requests can use it
      await supabase
        .from("users")
        .update({ github_token: githubToken })
        .eq("id", user.id);
    } else {
      // Fall back to the persisted token
      const { data: userRow } = await supabase
        .from("users")
        .select("github_token")
        .eq("id", user.id)
        .maybeSingle();
      githubToken = userRow?.github_token ?? null;
    }

    if (!githubToken) {
      logScan("github_required", { traceId, userId: user.id });
      return NextResponse.json(
        {
          error: "github_not_connected",
          message:
            "GitHub connection is required to start a scan. Connect GitHub in Settings.",
        },
        { status: 400 },
      );
    }

    const repoCheckRes = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
        },
      },
    );

    if (repoCheckRes.ok) {
      const repoData = await repoCheckRes.json();
      isPrivate = repoData.private === true;
    } else if (repoCheckRes.status === 404) {
      // Repo not accessible without a token — treat as private
      isPrivate = true;
    }
    // If GitHub API is unreachable, default isPrivate=false and let the scan proceed

    logScan("repo_parsed", { traceId, repoOwner, repoName, isPrivate });

    // ── Rate limiting ────────────────────────────────────────────────────────
    // Use adminSupabase (defined below for user upsert) for scans table ops
    // to avoid RLS blocking stale cleanup and rate-limit queries.
    const scansAdmin =
      SUPABASE_URL && SUPABASE_SERVICE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        : supabase;

    // First, auto-expire any pending/scanning rows older than 15 minutes —
    // these are stale rows the task never cleaned up (e.g. Trigger.dev run
    // expired, crashed before our catch block, etc.)
    const staleWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await scansAdmin
      .from("scans")
      .update({ status: "failed" })
      .eq("user_id", user.id)
      .in("status", ["pending", "scanning"])
      .lt("created_at", staleWindow);

    // Max 3 concurrent scans (pending/scanning) in the last 15 minutes
    const activeWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: activeCount } = await scansAdmin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["pending", "scanning"])
      .gte("created_at", activeWindow);

    if ((activeCount ?? 0) >= 3) {
      logScan("rate_limit_concurrent", {
        traceId,
        userId: user.id,
        activeCount,
      });
      await captureServerEvent(user.id, "scan_rate_limited", {
        traceId,
        activeCount: activeCount ?? 0,
      });
      return NextResponse.json(
        {
          error: "rate_limited",
          message:
            "You already have 3 scans in progress. Please wait for them to complete.",
        },
        { status: 429 },
      );
    }

    // ── Scan limit enforcement ─────────────────────────────────────────────────
    // Get user's plan and scan limits
    const { data: userData } = await supabase
      .from("users")
      .select("name, email, avatar_url, plan, scans_used, scans_limit")
      .eq("id", user.id)
      .maybeSingle();

    const plan = userData?.plan || "free";
    const scansLimit = userData?.scans_limit ?? 3;
    const scansUsed = userData?.scans_used ?? 0;

    // Check if user has scans remaining
    if (scansUsed >= scansLimit) {
      logScan("scan_limit_reached", {
        traceId,
        userId: user.id,
        plan,
        scansLimit,
        scansUsed,
      });
      await captureServerEvent(user.id, "scan_limit_reached", {
        traceId,
        plan,
        scansLimit,
        scansUsed,
      });
      return NextResponse.json(
        {
          error: "limit_reached",
          message: `You've used all your scans (${scansLimit}). Upgrade to get more scans!`,
          upgrade_url: "/pricing",
        },
        { status: 403 },
      );
    }

    logScan("scan_limit_checked", {
      traceId,
      userId: user.id,
      plan,
      scansLimit,
      scansUsed,
    });

    // ─────────────────────────────────────────────────────────────────────────

    const userName = userData?.name ?? null;
    const userAvatar = userData?.avatar_url ?? null;
    const userEmail = userData?.email ?? user.email;

    // Use the service-role client so this upsert succeeds regardless of RLS INSERT
    // policies on the users table.  Fall back to the user-scoped client if the
    // service key is not configured.
    const adminSupabase =
      SUPABASE_URL && SUPABASE_SERVICE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        : supabase;

    const { error: userUpsertError } = await adminSupabase.from("users").upsert(
      {
        id: user.id,
        email: userEmail,
        name: userName,
        avatar_url: userAvatar,
        plan: plan,
        scans_limit: scansLimit,
        scans_used: scansUsed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (userUpsertError) {
      console.error("Failed to upsert user record:", userUpsertError);
      logScan("user_upsert_failed", {
        traceId,
        error: userUpsertError.message,
      });
      // If the upsert itself failed, attempt a plain INSERT as last resort.
      // This handles race conditions where no row exists yet and the upsert
      // conflicted or was blocked.
      const { error: insertFallbackError } = await adminSupabase
        .from("users")
        .insert({
          id: user.id,
          email: userEmail,
          name: userName,
          avatar_url: userAvatar,
          plan: plan,
          scans_limit: scansLimit,
          scans_used: scansUsed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (insertFallbackError) {
        logScan("user_insert_fallback_failed", {
          traceId,
          error: insertFallbackError.message,
        });
      }
    }

    // Verify the user row actually exists before inserting a scan (FK guard).
    const { data: userRowCheck } = await adminSupabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRowCheck) {
      logScan("user_row_missing_abort", { traceId, userId: user.id });
      return NextResponse.json(
        {
          error: "database_error",
          message:
            "User profile could not be created. Please try again or contact support.",
        },
        { status: 500 },
      );
    }

    // Use admin client for scan insert to bypass RLS policies on the scans table
    const { data: scan, error: scanError } = await adminSupabase
      .from("scans")
      .insert({
        user_id: user.id,
        repo: repoUrl,
        branch: branch,
        framework: framework ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (scanError) {
      console.error("Failed to create scan:", scanError);
      logScan("scan_insert_failed", {
        traceId,
        error: scanError.message,
        code: scanError.code,
      });
      // Detect FK violation specifically to give a clearer error message
      const isFkError = scanError.code === "23503";
      return NextResponse.json(
        {
          error: "database_error",
          message: isFkError
            ? "User profile not found. Please refresh the page and try again."
            : "Failed to create scan record",
          details: scanError.message,
        },
        { status: 500 },
      );
    }

    // Trigger the scan task via Trigger.dev (no GitHub Actions, no webhooks)
    // Don't forward "unknown" framework — let the task auto-detect from package.json
    const handle = await tasks.trigger<typeof runScanTask>("run-scan", {
      scanId: scan.id,
      repoOwner,
      repoName,
      branch,
      framework: framework && framework !== "unknown" ? framework : undefined,
      githubToken: githubToken ?? undefined,
      triggerRunId: undefined, // will be updated by the task itself using context.run.id
    });

    // Store the Trigger.dev run ID so the progress API can retrieve real-time status
    await supabase
      .from("scans")
      .update({ trigger_run_id: handle.id })
      .eq("id", scan.id);

    logScan("trigger_success", {
      traceId,
      scanId: scan.id,
      triggerId: handle.id,
    });
    await captureServerEvent(user.id, "scan_started", {
      traceId,
      scanId: scan.id,
      repo: repoUrl,
      branch,
      framework: framework ?? "auto",
    });

    return NextResponse.json({
      scan_id: scan.id,
      status: "pending",
      repo: repoUrl,
      trace_id: traceId,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    console.error("Scan API error:", err);
    logScan("unhandled_exception", {
      traceId,
      message: err.message,
      stack: err.stack,
    });
    await captureServerEvent("anonymous", "scan_api_error", {
      traceId,
      message: err.message,
    });

    return NextResponse.json(
      {
        error: "internal_error",
        message: "An unexpected error occurred",
        details: err.message,
        trace_id: traceId,
      },
      { status: 500 },
    );
  }
}
