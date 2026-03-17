import { PostHog } from "posthog-node";

let client: PostHog | null = null;

function getPosthogClient(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

  if (!key) return null;
  if (client) return client;

  client = new PostHog(key, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });

  return client;
}

export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
) {
  const ph = getPosthogClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId,
      event,
      properties,
    });
    await ph.flush();
  } catch {
    // Ignore analytics failures so product flows are unaffected.
  }
}
