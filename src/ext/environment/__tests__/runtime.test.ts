/** The non-React half of `/ext/environment`. */
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentRuntime, maskEmails } from "../runtime";
import { normaliseKind, severityForKind } from "../types";

describe("maskEmails", () => {
  it("keeps the first character and the domain, drops the rest", () => {
    expect(maskEmails("nejc.mursic@example.com")).toBe("n***@example.com");
  });

  it("masks every address in a sentence", () => {
    expect(maskEmails("a@x.io and bob@y.co.uk")).toBe("a***@x.io and b***@y.co.uk");
  });

  it("leaves anything that is not an address alone", () => {
    expect(maskEmails("usr_123")).toBe("usr_123");
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
  /**
   * The regression that matters most in this file. Stringifying before
   * redacting hid the inner keys from `redact()`'s walk, so the token reached
   * the panel and the clipboard verbatim — while the row still claimed to be
   * masked, because a sibling email had been.
   */
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
      const stop = runtime.start({
        signal: controller.signal,
        isVisible: () => true,
        subscribeVisibility: () => () => {},
        getCommands: () => [],
        getDiagnostics: () => [],
        runCommand: async () => false,
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
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
    // `redact()` walks with `Object.entries`, which invokes getters, and the
    // first build runs at factory time: before core has mounted anything, so
    // there is no error boundary to catch this. It would take down the host
    // app's render, not degrade to an error chip.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runtime = createEnvironmentRuntime({
        detect: false,
        context: throwingExtra(),
      });
      const snapshot = runtime.store.getSnapshot();
      expect(snapshot.fields.find((field) => field.id === "contextError")?.value).toContain(
        "could not be read",
      );
      expect(spy).toHaveBeenCalled();
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
      expect(runtime.snapshotText()).toContain("could not be read");
      expect(JSON.stringify(runtime.diagnostics())).toContain("could not be read");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not throw uncaught from the poll interval", () => {
    // Inside a setInterval a throw is nobody's to catch.
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    try {
      const runtime = createEnvironmentRuntime({
        pollMs: 250,
        detect: false,
        context: () => throwingExtra(),
      });
      const stop = runtime.start({
        signal: controller.signal,
        isVisible: () => true,
        subscribeVisibility: () => () => {},
        getCommands: () => [],
        getDiagnostics: () => [],
        runCommand: async () => false,
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      stop();
    } finally {
      controller.abort();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("never reads an extra the allowlist dropped, so it cannot throw either", () => {
    // The allowlist filters before redaction, so the getter is never invoked
    // and there is nothing to degrade from.
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
      // The diagnostic row is not consumer data, so it survives the allowlist;
      // everything the allowlist dropped stays dropped.
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
});
