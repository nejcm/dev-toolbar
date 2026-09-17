/** The non-React half of `/ext/environment`. */
import { describe, expect, it, vi } from "vitest";
import { createSource } from "@nejcm/dev-toolbar/kit";
import { createNullStorage, fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { createEnvironmentRuntime, maskEmails } from "../runtime";
import type { EnvironmentContext } from "../types";
import { normaliseKind, severityForKind } from "../types";

describe("maskEmails", () => {
  it("keeps the first character and the domain, drops the rest", () => {
    expect(maskEmails("nejc.mursic@example.com")).toBe("n***@example.com");
  });

  it("masks every address in a sentence", () => {
    expect(maskEmails("a@x.io and bob@y.co.uk")).toBe("a***@x.io and b***@y.co.uk");
  });

  it("matches a form-encoded separator too, and preserves the one it found", () => {
    // `redactUrl()` re-serialises the query, so an address can arrive as `a%40b.io`.
    expect(maskEmails("login_hint=nejc%40example.com")).toBe("login_hint=n***%40example.com");
    expect(maskEmails("a@x.io and bob%40y.co.uk")).toBe("a***@x.io and b***%40y.co.uk");
  });

  it("leaves anything that is not an address alone", () => {
    expect(maskEmails("usr_123")).toBe("usr_123");
  });

  it("still masks the shapes the unbounded pattern did", () => {
    expect(maskEmails("a@b..io")).toBe("a***@b..io");
    expect(maskEmails(`a@${"l.".repeat(12)}com`)).toBe(`a***@${"l.".repeat(12)}com`);
    expect(maskEmails(`${"x".repeat(100)}@b.io`)).toBe("x***@b.io");
  });

  it("stays linear on a long run with no separator", () => {
    // `detectRoute()` feeds this an attacker-chosen URL fragment; the old
    // unbounded pattern rescanned from every start position (~10s at 100k chars).
    const time = (size: number) => {
      const input = `/#${"a".repeat(size)}`;
      const started = performance.now();
      maskEmails(input);
      return performance.now() - started;
    };
    time(10_000); // warm the JIT so the budget measures the scan, not compilation
    // Absolute budget, not a ratio, so a slow runner reads as slow, not a regression.
    expect(time(100_000)).toBeLessThan(1_000);
  });
});

describe("normaliseKind", () => {
  it("folds the spellings a deploy pipeline actually produces", () => {
    expect(normaliseKind("  Production ")).toBe("production");
    expect(normaliseKind("PROD")).toBe("production");
    expect(normaliseKind("Stage")).toBe("staging");
    expect(normaliseKind("Dev")).toBe("development");
    expect(normaliseKind("Blue")).toBe("blue");
  });
});

describe("severityForKind", () => {
  it("grades production whatever the deploy calls it", () => {
    // A grey chip on production is the failure §6 names by name.
    for (const spelling of ["production", "Production", "PROD", " prod "]) {
      expect(severityForKind(spelling, false), spelling).toBe("bad");
    }
    expect(severityForKind("Staging", false)).toBe("warn");
    expect(severityForKind("DEV", false)).toBe("ok");
  });

  it("marks production conspicuously and impersonation more so", () => {
    expect(severityForKind("production", false)).toBe("bad");
    expect(severityForKind("staging", false)).toBe("warn");
    expect(severityForKind("local", false)).toBe("ok");
    expect(severityForKind("unknown", false)).toBe("unknown");
    expect(severityForKind("whatever-we-call-it", false)).toBe("unknown");
    expect(severityForKind("local", true)).toBe("bad");
  });
});

describe("the snapshot", () => {
  it("says so when nothing was supplied", () => {
    const runtime = createEnvironmentRuntime({ detect: false });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.supplied).toBe(false);
    expect(snapshot.kind).toBe("unknown");
    expect(snapshot.fields.every((field) => field.source === "missing")).toBe(true);
    expect(runtime.snapshotText()).toBe(
      "Environment: unknown — no context was supplied to environment().",
    );
  });

  it("never lets an `extra` key shadow a real field", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: {
        region: "eu-central-1",
        extra: { region: "not the deploy region" },
      },
    });
    const fields = runtime.store.getSnapshot().fields;
    expect(fields.find((field) => field.id === "region")?.value).toBe("eu-central-1");
    expect(fields.find((field) => field.id === "extra:region")?.value).toBe(
      "not the deploy region",
    );
  });

  it("counts what it masked", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: {
        environment: "production",
        userId: "a@b.io",
        extra: { apiKey: "k-1", tool: "vite" },
      },
    });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.maskedCount).toBe(2);
    expect(snapshot.fields.find((f) => f.id === "extra:tool")?.masked).toBe(false);
  });

  it("honours extra redaction keys the consumer adds", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      redactOptions: { extraKeys: ["tenantcode"] },
      context: { extra: { tenantCode: "acme-secret" } },
    });
    expect(runtime.store.getSnapshot().fields.find((f) => f.id === "extra:tenantCode")?.value).toBe(
      "[redacted]",
    );
  });

  it("stringifies a structured extra rather than printing [object Object]", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { limits: { rps: 20 } } },
    });
    expect(runtime.store.getSnapshot().fields.find((f) => f.id === "extra:limits")?.value).toBe(
      '{"rps":20}',
    );
  });

  it("normalises builtAt to ISO, whatever shape it arrived in", () => {
    const at = Date.UTC(2026, 7, 28, 10, 4);
    for (const value of [at, new Date(at), new Date(at).toISOString()]) {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: { builtAt: value },
      });
      expect(runtime.store.getSnapshot().fields.find((f) => f.id === "builtAt")?.value).toBe(
        "2026-08-28T10:04:00.000Z",
      );
    }
  });

  it("passes an unparseable builtAt through instead of printing Invalid Date", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { builtAt: "whenever" },
    });
    expect(runtime.store.getSnapshot().fields.find((f) => f.id === "builtAt")?.value).toBe(
      "whenever",
    );
  });

  it("keeps detected facts out entirely when detect is false", () => {
    const runtime = createEnvironmentRuntime({ detect: false });
    expect(
      runtime.store.getSnapshot().fields.filter((field) => field.source === "detected"),
    ).toEqual([]);
  });
});

describe("diagnostics", () => {
  it("carries only redacted values and drops missing fields", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: {
        environment: "production",
        userId: "a@b.io",
        extra: { authorization: "Bearer super-secret" },
      },
    });
    const payload = runtime.diagnostics() as {
      environment: string;
      supplied: boolean;
      fields: { id: string; value: string; masked: boolean }[];
    };
    expect(payload.environment).toBe("production");
    expect(payload.supplied).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(payload.fields.map((field) => field.id)).toEqual([
      "environment",
      "userId",
      "extra:authorization",
    ]);
    expect(payload.fields.find((f) => f.id === "userId")?.value).toBe("a***@b.io");
  });
});

describe("nested `extra` values", () => {
  // Stringifying before redacting hid inner keys from `redact()`'s walk, so a
  // token reached the panel verbatim while the row still claimed to be masked.
  it("redacts keys inside a nested object", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: {
        extra: {
          user: { email: "nejc@example.com", authToken: "supersecret123" },
        },
      },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "extra:user");
    expect(field?.value).not.toContain("supersecret123");
    expect(field?.value).toContain("[redacted]");
    expect(field?.value).toContain("n***@example.com");
    expect(field?.masked).toBe(true);
  });

  it("keeps the nested leak out of the clipboard text and the JSON dump", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: {
        extra: {
          user: { authToken: "supersecret123" },
          note: {
            jwt: "eyJhbGciOi.eyJzdWIiOjEyMzQ1.SflKxwRJSMeKKF2QT4",
          },
        },
      },
    });
    expect(runtime.snapshotText()).not.toContain("supersecret123");
    expect(runtime.snapshotText()).not.toContain("SflKxwRJSMeKKF2QT4");
    expect(JSON.stringify(runtime.diagnostics())).not.toContain("supersecret123");
  });

  it("redacts a sensitive key nested inside an array", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { grants: [{ scope: "read", apiKey: "k-99" }] } },
    });
    expect(
      runtime.store.getSnapshot().fields.find((f) => f.id === "extra:grants")?.value,
    ).not.toContain("k-99");
  });

  it("does not claim to have masked a nested object it left alone", () => {
    // `masked` is what tells a reader "what you are looking at is not what was
    // supplied". A false positive there is the same lie in the other direction.
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { limits: { rps: 20, burst: 40 } } },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "extra:limits");
    expect(field?.value).toBe('{"rps":20,"burst":40}');
    expect(field?.masked).toBe(false);
  });

  it("renders an unserialisable extra instead of throwing", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { cyclic } },
    });
    expect(
      runtime.store.getSnapshot().fields.find((f) => f.id === "extra:cyclic")?.value,
    ).toContain("[circular]");
  });
});

describe("the `fields` allowlist", () => {
  it("drops `extra:*` rows nobody asked for", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      fields: ["environment"],
      context: {
        environment: "production",
        extra: { tenantTier: "enterprise" },
      },
    });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.fields.map((field) => field.id)).toEqual(["environment"]);
    expect(runtime.snapshotText()).not.toContain("enterprise");
    expect(JSON.stringify(runtime.diagnostics())).not.toContain("enterprise");
  });

  it("never reads the route when the row is excluded", () => {
    // Asserting the row is absent would pass either way; what needs pinning is
    // that `location` is never *read*, so this substitutes one whose `pathname` throws.
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        get pathname(): string {
          throw new Error("detectRoute() read location for an excluded row");
        },
      },
    });
    try {
      const runtime = createEnvironmentRuntime({
        fields: ["environment"],
        context: { environment: "production" },
      });
      const snapshot = runtime.store.getSnapshot();
      expect(snapshot.fields.map((field) => field.id)).toEqual(["environment"]);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("lets an extra through when it is named", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      fields: ["environment", "extra:tenantTier"],
      context: {
        environment: "production",
        extra: { tenantTier: "enterprise", internalNote: "do not show" },
      },
    });
    const ids = runtime.store.getSnapshot().fields.map((field) => field.id);
    expect(ids).toEqual(["environment", "extra:tenantTier"]);
    expect(runtime.snapshotText()).toContain("enterprise");
    expect(runtime.snapshotText()).not.toContain("do not show");
  });
});

describe("the environment string itself", () => {
  it("is redacted everywhere it is shown, not only in its own row", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { environment: "preview-nejc@example.com" },
    });
    const snapshot = runtime.store.getSnapshot();
    // The loose local-part match swallows the `preview-` prefix too. Over-
    // masking here is the safe direction; leaking the address was not.
    expect(String(snapshot.kind)).toBe("p***@example.com");
    expect(JSON.stringify(runtime.diagnostics())).not.toContain("nejc@example.com");
  });

  it("still grades a production environment that is spelled differently", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { environment: "Prod" },
    });
    const snapshot = runtime.store.getSnapshot();
    expect(snapshot.severity).toBe("bad");
    expect(snapshot.fields.find((field) => field.id === "environment")?.alarming).toBe(true);
  });
});

describe("staleness", () => {
  it("polls for detected facts even when the context is a static object", () => {
    // `history.pushState` fires nothing anyone can listen for, so without a
    // timer the Route row is wrong until something else repaints it.
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const runtime = createEnvironmentRuntime({
        pollMs: 250,
        context: { environment: "staging" },
      });
      const stop = runtime.start(
        fakeExtensionApi({ signal: controller.signal, storage: createNullStorage() }).api,
      );
      const route = () => runtime.store.getSnapshot().fields.find((f) => f.id === "route")?.value;
      expect(route()).toBe("/");
      history.pushState({}, "", "/acme/project/ABC");
      vi.advanceTimersByTime(600);
      runtime.store.flush();
      expect(route()).toBe("/acme/project/ABC");
      stop();
    } finally {
      history.pushState({}, "", "/");
      controller.abort();
      vi.useRealTimers();
    }
  });

  it("uses the environment default when pollMs is non-finite", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const context = vi.fn(() => ({ environment: "staging" }));
    try {
      const runtime = createEnvironmentRuntime({ pollMs: Number.NaN, detect: false, context });
      const stop = runtime.start(
        fakeExtensionApi({ signal: controller.signal, storage: createNullStorage() }).api,
      );
      expect(context).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(3999);
      expect(context).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(context).toHaveBeenCalledTimes(3);
      stop();
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  });
});

describe("a context that throws while being read", () => {
  const throwingExtra = () => ({
    extra: {
      bad: {
        get boom(): string {
          throw new Error("getter blew up");
        },
      },
    },
  });

  it("does not throw out of the factory — a getter inside `extra`", () => {
    // `redact()` tags a throwing getter itself (`"[getter threw]"`) rather than
    // propagating, so a normal snapshot comes back with just that property tagged.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: throwingExtra(),
      });
      const snapshot = runtime.store.getSnapshot();
      const field = snapshot.fields.find((field) => field.id === "extra:bad");
      expect(field?.value).toContain("[getter threw]");
      expect(snapshot.fields.some((field) => field.id === "contextError")).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not throw out of the factory — a getter on the context object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: {
          get userId(): string {
            throw new Error("getter blew up");
          },
        },
      });
      expect(runtime.store.getSnapshot().fields.some((field) => field.id === "contextError")).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the copy paths working instead of throwing at the clipboard", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: throwingExtra(),
      });
      expect(runtime.snapshotText()).toContain("[getter threw]");
      expect(JSON.stringify(runtime.diagnostics())).toContain("[getter threw]");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not throw uncaught from the poll interval", () => {
    // A getter directly on the context object is read outside `redact()`, so
    // it still needs to hit build()'s own catch (unlike a getter inside `extra`).
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    try {
      const runtime = createEnvironmentRuntime({
        pollMs: 250,
        detect: false,
        context: () => ({
          get userId(): string {
            throw new Error("getter blew up");
          },
        }),
      });
      const stop = runtime.start(
        fakeExtensionApi({ signal: controller.signal, storage: createNullStorage() }).api,
      );
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(spy).toHaveBeenCalled();
      stop();
    } finally {
      controller.abort();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("never reads an extra the allowlist dropped, so it cannot throw either", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        fields: ["environment"],
        context: { environment: "staging", ...throwingExtra() },
      });
      expect(runtime.store.getSnapshot().fields.map((field) => field.id)).toEqual(["environment"]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("still honours the `fields` allowlist while degraded", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        fields: ["environment"],
        context: {
          get userId(): string {
            throw new Error("getter blew up");
          },
        },
      });
      // The diagnostic row is not consumer data, so it survives the allowlist.
      expect(runtime.store.getSnapshot().fields.map((field) => field.id)).toEqual([
        "contextError",
        "environment",
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("`masked` on a Date-valued extra", () => {
  it("is not set — the two sides are rendered the same way", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { deployedAt: new Date(Date.UTC(2026, 7, 28)) } },
    });
    const field = runtime.store
      .getSnapshot()
      .fields.find((entry) => entry.id === "extra:deployedAt");
    expect(field?.value).toBe("2026-08-28T00:00:00.000Z");
    expect(field?.masked).toBe(false);
  });

  it("tags an invalid Date instead of degrading the whole snapshot", () => {
    // `new Date(NaN).toISOString()` throws; unguarded, that used to take down
    // build()'s whole snapshot rather than costing just this one field.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: { extra: { bad: new Date(NaN) } },
      });
      const snapshot = runtime.store.getSnapshot();
      const field = snapshot.fields.find((entry) => entry.id === "extra:bad");
      expect(field?.value).toBe("[invalid date]");
      expect(snapshot.fields.some((entry) => entry.id === "contextError")).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("URL-shaped fields", () => {
  // `detectRoute()` returns a relative reference, which `redact()`'s value
  // pass never inspects (it only fires on `scheme://…`), so an OAuth implicit
  // callback's `access_token` must be caught by the explicit `redactUrl()` pass instead.
  const routeField = (search: string, hash: string) => {
    history.pushState({}, "", `/callback${search}${hash}`);
    try {
      const runtime = createEnvironmentRuntime({ context: { environment: "staging" } });
      const snapshot = runtime.store.getSnapshot();
      return {
        field: snapshot.fields.find((entry) => entry.id === "route"),
        text: runtime.snapshotText(),
        dump: JSON.stringify(runtime.diagnostics()),
        maskedCount: snapshot.maskedCount,
      };
    } finally {
      history.pushState({}, "", "/");
    }
  };

  it("masks a token in both the query and the hash of a detected route", () => {
    const { field, text, dump } = routeField("?access_token=abc123", "#id_token=xyz789&state=s");
    expect(field?.value).toBe("/callback?access_token=[redacted]#id_token=[redacted]&state=s");
    expect(field?.value).not.toContain("abc123");
    expect(field?.value).not.toContain("xyz789");
    // A closed leak labelled unmasked is worse than the leak itself.
    expect(field?.masked).toBe(true);
    expect(field?.source).toBe("detected");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("xyz789");
    expect(dump).not.toContain("abc123");
    expect(dump).not.toContain("xyz789");
  });

  it("leaves a route with nothing to mask byte-for-byte, and says so", () => {
    const { field } = routeField("?page=2&sort=name", "#section-3");
    expect(field?.value).toBe("/callback?page=2&sort=name#section-3");
    expect(field?.masked).toBe(false);
  });

  it("counts the masked route in the footer snapshotText() prints", () => {
    const { text, maskedCount } = routeField("?access_token=abc123", "");
    expect(maskedCount).toBe(1);
    expect(text).toContain("(1 value masked before copying)");
    const lines = text.split("\n").filter((line) => line.startsWith("Route: "));
    expect(lines).toEqual(["Route: /callback?access_token=[redacted]"]);
  });

  it("masks userinfo in an absolute wss:// endpoint", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { apiEndpoint: "wss://user:pass@a.test/socket" },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "apiEndpoint");
    expect(field?.value).toBe("wss://[redacted]:[redacted]@a.test/socket");
    expect(field?.masked).toBe(true);
  });

  it("masks a protocol-relative endpoint's password rather than mangling it", () => {
    // A protocol-relative endpoint has no `scheme://`, so only the explicit
    // `redactUrl()` pass sees it — without it the email pass mangled the
    // password to `p***@` instead of masking it.
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { apiEndpoint: "//user:pass@a.test/socket" },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "apiEndpoint");
    expect(field?.value).toBe("//[redacted]:[redacted]@a.test/socket");
    expect(field?.value).not.toContain("p***@");
    expect(field?.masked).toBe(true);
  });

  it("still masks an address beside a masked token — redactUrl() re-serialises @ as %40", () => {
    // Masking any query parameter re-serialises the whole query, form-encoding
    // every other `@` as `%40` — hence `EMAIL` must accept `%40` too.
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { apiEndpoint: "/callback?access_token=abc&login_hint=nejc@example.com" },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "apiEndpoint");
    expect(field?.value).toBe("/callback?access_token=[redacted]&login_hint=n***%40example.com");
    expect(field?.value).not.toContain("nejc");
    expect(field?.masked).toBe(true);
  });

  it("keeps a sensitive key matchable when the key itself contains an address", () => {
    // The reason `redactUrl()` goes first: key matching must see `token@x.co`
    // before the email pass rewrites it to `t***@x.co`.
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { apiEndpoint: "/cb?token@x.co=secret" },
    });
    const field = runtime.store.getSnapshot().fields.find((entry) => entry.id === "apiEndpoint");
    expect(field?.value).not.toContain("secret");
    expect(field?.value).toBe("/cb?t***%40x.co=[redacted]");
  });

  it("covers a string-valued extra the module cannot enumerate", () => {
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: { extra: { callbackUrl: "/oauth/done?access_token=xyz789", note: "all fine" } },
    });
    const fields = runtime.store.getSnapshot().fields;
    const callback = fields.find((entry) => entry.id === "extra:callbackUrl");
    expect(callback?.value).toBe("/oauth/done?access_token=[redacted]");
    expect(callback?.masked).toBe(true);
    const note = fields.find((entry) => entry.id === "extra:note");
    expect(note?.value).toBe("all fine");
    expect(note?.masked).toBe(false);
  });
});

describe("revision", () => {
  // Regression: revision used to bump on every build(), so read-only exports
  // like snapshotText()/diagnostics() advanced the counter without publishing.
  it("advances revision only on publish, not on export reads", () => {
    let env = "dev";
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: () => ({ environment: env }),
    });
    const before = runtime.store.getSnapshot().revision;
    runtime.snapshotText();
    runtime.snapshotText();
    runtime.diagnostics();
    expect(runtime.store.getSnapshot().revision).toBe(before);
    env = "staging";
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().revision).toBe(before + 1);
  });

  it("does not advance revision when export reads hit a throwing context getter", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let healthy = false;
    const runtime = createEnvironmentRuntime({
      detect: false,
      context: () => {
        if (!healthy) throw new Error("boom");
        return { environment: "dev" };
      },
    });
    const before = runtime.store.getSnapshot().revision;
    runtime.snapshotText();
    runtime.diagnostics();
    expect(runtime.store.getSnapshot().revision).toBe(before);
    healthy = true;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().revision).toBe(before + 1);
  });
});

describe("publication guarantees", () => {
  it("publishes an isolated field value once and preserves fixed metadata", () => {
    let region = "eu";
    const runtime = createEnvironmentRuntime({
      detect: false,
      fields: ["region"],
      context: () => ({ region }),
    });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    region = "us";
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().fields).toEqual([{ ...before.fields[0], value: "us" }]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  // The proxy rows these are usually read through are excluded, so the
  // top-level field is the only thing that changes.
  it.each([
    ["kind", { environment: "blue" }, { environment: "green" }, { kind: "green" }],
    [
      "impersonating",
      { environment: "production", impersonating: false },
      { environment: "production", impersonating: true },
      { impersonating: true },
    ],
    ["supplied", {}, { region: "eu" }, { supplied: true }],
    [
      "kind and dependent severity",
      { environment: "local" },
      { environment: "production" },
      { kind: "production", severity: "bad" },
    ],
  ] as const)("publishes %s when fields are excluded", (_name, initial, next, delta) => {
    let context: EnvironmentContext = initial;
    const runtime = createEnvironmentRuntime({ detect: false, fields: [], context: () => context });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    context = next;
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.peek()).toEqual({
      ...before,
      ...delta,
      revision: before.revision + 1,
      at: expect.any(Number),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
    runtime.store.destroy();
  });

  // The literal value here equals its own mask text, so only the flag differs.
  it("publishes field.masked and maskedCount changes behind the same display text", () => {
    let userId = "Bearer abcdefghijklmnop";
    const runtime = createEnvironmentRuntime({
      detect: false,
      fields: ["userId"],
      context: () => ({ userId }),
    });
    const before = runtime.store.getSnapshot();
    expect(before.fields[0]?.masked).toBe(true);
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    userId = before.fields[0]?.value ?? "";
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.peek().fields).toEqual([{ ...before.fields[0], masked: false }]);
    expect(runtime.store.peek().maskedCount).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
    runtime.store.destroy();
  });

  it("publishes source and alarming changes with their determining values", () => {
    let context: EnvironmentContext = {};
    const runtime = createEnvironmentRuntime({
      detect: false,
      fields: ["environment", "impersonation"],
      context: () => context,
    });
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    context = { environment: "production", impersonating: true };
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().fields).toMatchObject([
      { id: "environment", source: "supplied", alarming: true, value: "production" },
      { id: "impersonation", source: "supplied", alarming: true, value: "ACTIVE" },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });

  it("rebuilds immediately into peek; leading publication, trailing interval and explicit flush differ", async () => {
    vi.useFakeTimers();
    let region = "eu";
    const runtime = createEnvironmentRuntime({ detect: false, context: () => ({ region }) });
    try {
      const listener = vi.fn();
      runtime.store.subscribe(listener);
      const initial = runtime.store.getSnapshot();
      region = "us";
      runtime.refresh();
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(listener).toHaveBeenCalledTimes(1);
      const first = runtime.store.getSnapshot();
      region = "ap";
      runtime.refresh();
      expect(runtime.store.peek().revision).toBe(initial.revision + 2);
      expect(runtime.store.getSnapshot()).toBe(first);
      await Promise.resolve();
      expect(runtime.store.getSnapshot()).toBe(first);
      vi.advanceTimersByTime(249);
      expect(listener).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(runtime.store.getSnapshot()).toBe(runtime.store.peek());
      expect(listener).toHaveBeenCalledTimes(2);
      region = "ca";
      runtime.refresh();
      runtime.store.flush();
      expect(listener).toHaveBeenCalledTimes(3);
      const stable = runtime.store.getSnapshot();
      runtime.snapshotText();
      runtime.diagnostics();
      expect(runtime.store.peek()).toBe(stable);
      runtime.refresh();
      runtime.store.flush();
      expect(runtime.store.peek().revision).toBe(stable.revision + 1);
      expect(runtime.store.getSnapshot()).toBe(stable);
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      runtime.store.destroy();
      vi.useRealTimers();
    }
  });
});

describe("environment field identity publication", () => {
  it("publishes an extra ID with its derived label while group remains fixed", () => {
    let extra = { first: "same" } as Record<string, string>;
    const runtime = createEnvironmentRuntime({ detect: false, context: () => ({ extra }) });
    const before = runtime.store.getSnapshot();
    const listener = vi.fn();
    runtime.store.subscribe(listener);
    extra = { second: "same" };
    runtime.refresh();
    runtime.store.flush();
    expect(runtime.store.getSnapshot().fields).toEqual(
      before.fields.map((field) =>
        field.id === "extra:first" ? { ...field, id: "extra:second", label: "second" } : field,
      ),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.store.destroy();
  });
});

describe("a Readable context", () => {
  const api = (signal: AbortSignal) =>
    fakeExtensionApi({ signal, storage: createNullStorage() }).api;
  const field = (runtime: ReturnType<typeof createEnvironmentRuntime>, id: string) =>
    runtime.store.getSnapshot().fields.find((f) => f.id === id)?.value;

  it("republishes when the source notifies, with no timer of its own", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const source = createSource<EnvironmentContext>({ region: "eu-west-1" });
      const read = vi.spyOn(source, "read");
      const runtime = createEnvironmentRuntime({ context: source, detect: false, pollMs: 250 });
      const stop = runtime.start(api(controller.signal));
      const afterStart = read.mock.calls.length;

      vi.advanceTimersByTime(60_000);
      expect(read.mock.calls.length).toBe(afterStart);
      expect(field(runtime, "region")).toBe("eu-west-1");

      source.set({ region: "ap-southeast-1" });
      runtime.store.flush();
      expect(field(runtime, "region")).toBe("ap-southeast-1");
      stop();
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  });

  it("keeps the detection timer while detect is on", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const runtime = createEnvironmentRuntime({
        context: createSource<EnvironmentContext>({ environment: "staging" }),
        pollMs: 250,
      });
      const stop = runtime.start(api(controller.signal));
      expect(field(runtime, "route")).toBe("/");
      history.pushState({}, "", "/from/a/readable");
      vi.advanceTimersByTime(600);
      runtime.store.flush();
      expect(field(runtime, "route")).toBe("/from/a/readable");
      stop();
    } finally {
      history.pushState({}, "", "/");
      controller.abort();
      vi.useRealTimers();
    }
  });

  it("unsubscribes exactly once when core aborts and then calls the cleanup", () => {
    const controller = new AbortController();
    const source = createSource<EnvironmentContext>({ region: "eu" });
    const unsubscribe = vi.fn(source.subscribe(() => {}));
    const subscribe = vi.fn(() => unsubscribe);
    const runtime = createEnvironmentRuntime({
      context: { read: source.read, subscribe },
      detect: false,
    });
    const stop = runtime.start(api(controller.signal));
    expect(subscribe).toHaveBeenCalledTimes(1);

    // The order core's stopExtension uses: abort the signal, then the returned cleanup.
    controller.abort();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    source.set({ region: "us" });
    runtime.store.flush();
    expect(field(runtime, "region")).toBe("eu");
  });

  it("finishes tearing down when the unsubscribe throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeExtensionApi({ storage: createNullStorage() });
    try {
      const source = createSource<EnvironmentContext>({ region: "eu" });
      const read = vi.fn(source.read);
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: {
          read,
          subscribe: (listener) => {
            source.subscribe(listener);
            return () => {
              throw new Error("released twice");
            };
          },
        },
      });
      const stop = runtime.start(fake.api);
      const afterStart = read.mock.calls.length;

      expect(() => stop()).not.toThrow();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("unsubscribe threw"),
        expect.any(Error),
      );

      // The visibility subscription was still released: a flip no longer re-reads.
      fake.setVisible(false);
      expect(read.mock.calls.length).toBe(afterStart);
    } finally {
      fake.abort();
      spy.mockRestore();
    }
  });

  it("accepts a { getState, subscribe } store as-is", () => {
    const controller = new AbortController();
    try {
      const source = createSource<EnvironmentContext>({ workspaceId: "ws-1" });
      const store = { getState: source.read, subscribe: source.subscribe };
      const runtime = createEnvironmentRuntime({ context: store, detect: false });
      runtime.start(api(controller.signal));
      expect(field(runtime, "workspaceId")).toBe("ws-1");
      source.set({ workspaceId: "ws-2" });
      runtime.store.flush();
      expect(field(runtime, "workspaceId")).toBe("ws-2");
    } finally {
      controller.abort();
    }
  });

  it("degrades to an empty context when read() throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: {
          read: () => {
            throw new Error("store blew up");
          },
          subscribe: () => () => {},
        },
      });
      expect(runtime.store.getSnapshot().supplied).toBe(false);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
