import { defineConfig } from "@trigger.dev/sdk/v3";
import { aptGet } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_ldantbfoufyqhgdvgghm",
  dirs: ["./trigger"],
  maxDuration: 600,
  build: {
    extensions: [
      // install git so we can clone repos inside the task container
      aptGet({ packages: ["git"] }),
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
