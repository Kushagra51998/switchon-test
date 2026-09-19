import type { Asset, AssetPage, AssetQuery, BulkResult } from "@/lib/types";

interface RequestOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
  dedupe?: boolean;
}

// A class to keep the errors sorted out
class RequestError extends Error {
  status?: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);

    this.name = "RequestError";
    this.status = options.status;
    this.retryable = options.retryable;

    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Baseline client. It works on a good network and falls apart on a bad one.
 *
 * Known gaps, all of which are yours to close:
 *   - no request cancellation
 *   - no retry, no backoff, no handling of Retry-After
 *   - no de-duplication of concurrent identical requests
 *   - error information is flattened into a string
 *   - callers cannot distinguish "retry this" from "do not retry this"
 */

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status?.length) params.set("status", query.status.join(","));
  if (query.kind?.length) params.set("kind", query.kind.join(","));
  if (query.tag?.length) params.set("tag", query.tag.join(","));
  if (query.collectionId) params.set("collectionId", query.collectionId);
  if (query.owner) params.set("owner", query.owner);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

// A map to keep a track of pending requests
const pendingRequests = new Map<string, Promise<unknown>>();

function getRequestKey(
  path: string,
  method: string,
  body?: BodyInit | null,
): string {
  return JSON.stringify({
    path,
    method,
    body: body ?? null,
  });
}

// Retry based on status
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// exponential backoff delay
function getBackoffDelay(attempt: number, baseDelay: number): number {
  return baseDelay * 2 ** attempt;
}

function getRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("Retry-After");

  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(retryAfter);

  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The request was aborted", "AbortError"));

      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const onAbort = () => {
      clearTimeout(timer);

      reject(new DOMException("The request was aborted", "AbortError"));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, {
      once: true,
    });
  });
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  // Added Abort Signal for request cancellation

  const {
    maxRetries = 3,
    baseDelay = 500,
    signal: externalSignal,
    dedupe = true,
    headers,
    method = "GET",
    ...init
  } = options ?? {};

  const normalizedMethod = method.toUpperCase();

  // Deduplicate GET and HEAD requests only.
  // This avoids unintentionally deduplicating mutations.
  const shouldDedupe =
    dedupe && (normalizedMethod === "GET" || normalizedMethod === "HEAD");

  // The key kept in the record to prevent duplicate
  const key = getRequestKey(path, normalizedMethod, init.body);

  if (shouldDedupe) {
    const pending = pendingRequests.get(key);

    if (pending) {
      return pending as Promise<T>;
    }
  }

  const controller = new AbortController();

  const abortHandler = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else {
    externalSignal?.addEventListener("abort", abortHandler, { once: true });
  }

  const execute = async (): Promise<T> => {
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let res: Response;

        try {
          res = await fetch(path, {
            ...init,
            method: normalizedMethod,
            headers: {
              "content-type": "application/json",
              ...(headers ?? {}),
            },
            signal: controller.signal,
          });
        } catch (error) {
          // Abort errors must never be retried.
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            throw error;
          }

          const canRetry = attempt < maxRetries;

          if (!canRetry) {
            throw new RequestError(
              error instanceof Error ? error.message : "Network request failed",
              {
                retryable: true,
                cause: error,
              },
            );
          }

          const retryDelay = getBackoffDelay(attempt, baseDelay);

          await delay(retryDelay, controller.signal);

          continue;
        }

        if (res.ok) {
          return (await res.json()) as T;
        }

        let detail = res.statusText;
        let body: unknown;

        try {
          body = await res.json();

          if (typeof body === "object" && body !== null && "error" in body) {
            const error = (
              body as {
                error?: {
                  message?: string;
                };
              }
            ).error;

            detail = error?.message ?? detail;
          }
        } catch {
          // Response was not JSON.
        }

        const retryable = isRetryableStatus(res.status);

        const canRetry = retryable && attempt < maxRetries;

        if (!canRetry) {
          throw new RequestError(`${res.status}: ${detail}`, {
            status: res.status,
            retryable,
          });
        }

        const retryAfter = getRetryAfter(res);

        const retryDelay = retryAfter ?? getBackoffDelay(attempt, baseDelay);

        await delay(retryDelay, controller.signal);
      }

      throw new RequestError("Request failed after retries", {
        retryable: true,
      });
    } finally {
      externalSignal?.removeEventListener("abort", abortHandler);
    }
  };

  const promise = execute();

  if (shouldDedupe) {
    pendingRequests.set(key, promise);

    promise
      .finally(() => {
        if (pendingRequests.get(key) === promise) {
          pendingRequests.delete(key);
        }
      })
      .catch(() => {
        // Prevent unhandled rejection from the cleanup promise.
      });
  }

  return promise;
}

export function listAssets(
  query: AssetQuery,
  option?: RequestOptions,
): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, option);
}

export function getAsset(id: string): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`);
}

export function getAssetsByIds(
  ids: string[],
): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call.
  return request(`/api/assets/batch?ids=${ids.join(",")}`);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, "name" | "status" | "tags">>,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(
  ids: string[],
  status: Asset["status"],
): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call.
  return request<BulkResult>("/api/assets/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
