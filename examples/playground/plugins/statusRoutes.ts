/**
 * Playground-only Vite middleware that answers `GET /__status/<code>` with
 * that HTTP status, so the app's *3 requests (404)* button produces real
 * non-2xx responses for `/ext/metrics`' network collector to count as failed.
 *
 * A made-up path is not enough: Vite's SPA fallback serves `index.html` with
 * `200` for any extension-less path a `fetch` asks for (its `Accept: *\/*`
 * admits HTML), so the "failures" would all land as `completed` with
 * `failed: 0` and the `ok: false` path would go unexercised.
 *
 * Dev-server only (`apply: "serve"`), installed ahead of Vite's own
 * middlewares so the fallback never sees these paths. Codes outside 400–599
 * are refused with `400`: this exists to fail requests on purpose.
 */
import type { Plugin } from "vite";

const PREFIX = "/__status/";

export function statusRoutes(): Plugin {
  return {
    name: "playground-status-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "/").split("?")[0] ?? "/";
        if (!pathname.startsWith(PREFIX)) {
          next();
          return;
        }
        const code = Number(pathname.slice(PREFIX.length));
        const valid = Number.isInteger(code) && code >= 400 && code <= 599;
        res.statusCode = valid ? code : 400;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(valid ? `status ${code}, on purpose\n` : "expected /__status/<400-599>\n");
      });
    },
  };
}
