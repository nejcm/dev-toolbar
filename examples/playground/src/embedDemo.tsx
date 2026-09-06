import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { embed } from "@nejcm/dev-toolbar/kit";

/**
 * A real third-party devtool on the bar, through the recipe in docs/embedding.md.
 *
 * TanStack Query's devtools panel is the canonical case: it is somebody else's
 * UI, it brings its own stylesheet (injected into `document.head` by the
 * devtools themselves — the toolbar neither scopes nor resets it), and it
 * wants a definite height. `embed()` supplies the chip, hands the panel height
 * through, mounts nothing until the chip is first clicked, and keeps the panel
 * alive across closes so the devtools' own UI state (the selected query, the
 * filter) survives. Everything else is core's: the trigger, the single-panel
 * rule, and the error boundary around the slot.
 *
 * The package never names `@tanstack/*`: both libraries are devDependencies of
 * this playground only, and the `QueryClient` is injected — shape A from
 * plans/ecosystem-extensions.md.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false } },
});

/** Live query count for the chip — an element that subscribes to the tool's own state. */
function QueryCount(): ReactNode {
  const [count, setCount] = useState(() => queryClient.getQueryCache().getAll().length);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe(() => {
        setCount(queryClient.getQueryCache().getAll().length);
      }),
    [],
  );
  return count;
}

/** Built once, at module scope, like every other factory. */
export const tanstackQuery = embed({
  id: "tanstack-query",
  label: "query",
  value: <QueryCount />,
  order: 45,
  priority: 65,
  keepMounted: true,
  render: ({ close }) => (
    <ReactQueryDevtoolsPanel
      client={queryClient}
      // Fill the frame; core owns the height and the frame tracks the resizer.
      style={{ height: "100%" }}
      onClose={close}
    />
  ),
});

/** Provides the same client to the page, so the panel shows this page's queries. */
export function EmbedDemoProvider({ children }: { children: ReactNode }): ReactNode {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchTodos(page: number): Promise<{ page: number; items: string[] }> {
  await wait(600);
  return {
    page,
    items: Array.from({ length: 4 }, (_, index) => `todo ${page}-${index + 1}`),
  };
}

async function fetchBroken(): Promise<never> {
  await wait(400);
  throw new Error("playground: this query is deliberately broken");
}

/** A card with enough query activity for the devtools panel to have something to show. */
export function QueryPlayground(): ReactNode {
  const [page, setPage] = useState(1);
  const todos = useQuery({ queryKey: ["todos", page], queryFn: () => fetchTodos(page) });
  const broken = useQuery({ queryKey: ["broken"], queryFn: fetchBroken, enabled: false });

  return (
    <section className="pg-card">
      <h2>Drive the embedded devtools</h2>
      <p>
        The <code>query</code> chip is TanStack Query's own devtools panel, mounted through{" "}
        <code>embed()</code> from <code>@nejcm/dev-toolbar/kit</code> — the recipe in{" "}
        <code>docs/embedding.md</code>. Its stylesheet is its own: the toolbar injects nothing for
        it and scopes nothing around it. Nothing is mounted until the chip is first clicked; after
        that, <code>keepMounted</code> keeps it alive so the panel's own state survives closing.
      </p>
      <p>
        Page {todos.data?.page ?? page}:{" "}
        {todos.isPending ? "loading…" : todos.isError ? "failed" : todos.data.items.join(", ")}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="pg-button"
          data-testid="query-next-page"
          onClick={() => setPage((value) => value + 1)}
        >
          Next page
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="query-refetch"
          onClick={() => void todos.refetch()}
        >
          Refetch
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="query-invalidate"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["todos"] })}
        >
          Invalidate todos
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="query-break"
          onClick={() => void broken.refetch()}
        >
          Run the broken query
        </button>
      </div>
    </section>
  );
}
