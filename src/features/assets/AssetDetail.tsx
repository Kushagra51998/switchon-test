import { useCallback, useEffect, useRef, useState } from "react";
import { getAsset, thumbnailUrl, updateAsset } from "@/api/client";
import {
  formatBytes,
  formatDate,
  formatDuration,
  statusLabel,
} from "@/lib/format";
import type { Asset, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

/**
 * Baseline detail panel. Loads on open, saves with no optimistic update,
 * surfaces failures as raw strings, and does nothing about focus.
 */
export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Tracks the latest save operation.
  const saveRequestId = useRef(0);

  useEffect(() => {
    setAsset(null);
    setError(null);
    setLoading(true);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Load failed"),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const setStatus = useCallback(
    async (status: AssetStatus) => {
      if (!asset || saving || status === asset.status) {
        return;
      }

      const previousAsset = asset;
      const requestId = ++saveRequestId.current;

      setError(null);

      // Optimistic update: update UI immediately.
      const optimisticAsset: Asset = {
        ...previousAsset,
        status,
      };

      setAsset(optimisticAsset);
      setSaving(true);

      try {
        const updated = await updateAsset(
          previousAsset.id,
          previousAsset.version,
          { status },
        );

        // Ignore stale save responses.
        if (requestId !== saveRequestId.current) {
          return;
        }

        // Replace optimistic data with server response.
        setAsset(updated);
        onSaved(updated);
      } catch (err: unknown) {
        if (requestId !== saveRequestId.current) {
          return;
        }

        // Rollback if the API request fails.
        setAsset(previousAsset);

        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        if (requestId === saveRequestId.current) {
          setSaving(false);
        }
      }
    },
    [asset, saving, onSaved],
  );

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>

        <button onClick={onClose}>Close</button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="muted">Loading…</p>}

      {!loading && !asset && !error && (
        <p className="muted">Asset not found.</p>
      )}

      {saving && (
        <p className="muted" role="status">
          Saving…
        </p>
      )}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width != null && asset.height != null && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec != null && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
                aria-pressed={status === asset.status}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
