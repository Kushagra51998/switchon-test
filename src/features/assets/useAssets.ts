import { useEffect, useRef, useState } from "react";
import { listAssets } from "@/api/client";
import type { Asset, AssetQuery } from "@/lib/types";

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Baseline loader. Reviewers know this hook is wrong in several ways.
 * Replacing it wholesale is expected and encouraged.
 */

// Keys make unnesary re renders
// Missing abort controller
// Race condition fix
// We should utilize react query to optimize api calls

function useMemoizedQuery<T>(value: T): T {
  const ref = useRef<T>(value);

  if (JSON.stringify(value) !== JSON.stringify(ref.current)) {
    ref.current = value;
  }

  return ref.current;
}

export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    error: null,
  });

  const memoizedQuery = useMemoizedQuery(query);

  useEffect(() => {
    let isCancelled = false; // Flag tracks if THIS specific effect run was cleaned up

    setState((s) => ({ ...s, loading: true, error: null }));

    // There is a abort controller but inside the client.ts
    listAssets(memoizedQuery)
      .then((page) => {
        // If the component unmounted or query changed, discard the result
        if (isCancelled) return;

        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        // Ignore errors if the effect was cleaned up or if it was an explicit abort
        if (isCancelled) return;

        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Something went wrong",
        }));
      });

    return () => {
      isCancelled = true;
    };
  }, [memoizedQuery]);

  return state;
}
