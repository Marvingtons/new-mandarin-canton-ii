import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare adapter config.
 *
 * Deliberately empty. `defineCloudflareConfig(config?)` takes an entirely
 * optional argument, and every override it accepts is for CACHING —
 * incremental (ISR) cache, tag cache, revalidation queue, cache purge.
 *
 * This app has no ISR and no revalidating fetches: the menu is compiled into
 * the bundle (src/data/menu.ts via lib/menu/catalog.ts), every order route is
 * `dynamic = "force-dynamic"`, and the only cache-ish call in the tree is
 * revalidatePath("/kitchen") in a server action, which is served by the
 * WORKER_SELF_REFERENCE binding in wrangler.jsonc rather than by an
 * incremental cache.
 *
 * So there is no R2 bucket and no KV namespace to configure. The adapter's
 * own template ships `incrementalCache: r2IncrementalCache`; we drop it
 * on purpose. If a page ever gains `revalidate`, add the R2 override here and
 * create the bucket — see https://opennext.js.org/cloudflare/caching
 */
export default defineCloudflareConfig();
