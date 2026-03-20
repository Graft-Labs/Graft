import { PostHog } from "posthog-node";

let client: PostHog | null = null;
let disabledUntil = 0;

function getPosthogClient(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

  if (!key) return null;
  if (client) return client;

  client = new PostHog(key, {
    host,
    flushAt: 20,
    flushInterval: 10000,
    requestTimeout: 2000,
  });

  return client;
}

export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
) {
  if (Date.now() < disabledUntil) return;

  const ph = getPosthogClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId,
      event,
      properties,
    });
  } catch {
    // Back off after network errors to avoid log spam + request overhead.
    disabledUntil = Date.now() + 5 * 60 * 1000;
    // Ignore analytics failures so product flows are unaffected.
  }
}
