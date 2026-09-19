import { thumbnailUrl } from "@/api/client";
import { formatBytes, formatDate, statusLabel } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { memo, useCallback } from "react";

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

interface AssetCardProps {
  asset: Asset;
  isSelected: boolean;
  isActive: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

/**
 * Baseline grid. Renders every row it is given, re-renders every card on any
 * selection change, and is not reachable by keyboard.
 */

const AssetCard = memo(function AssetCardComponent({
  asset,
  isSelected,
  isActive,
  onToggleSelect,
  onOpen,
}: AssetCardProps) {
  const handleOpen = useCallback(() => {
    onOpen(asset.id);
  }, [onOpen, asset.id]);

  const handleSelection = useCallback(() => {
    onToggleSelect(asset.id);
  }, [onToggleSelect, asset.id]);

  return (
    <div
      className={
        "card" +
        (isSelected ? " card--selected" : "") +
        (isActive ? " card--active" : "")
      }
      onClick={handleOpen}
    >
      <img className="card__thumb" src={thumbnailUrl(asset.id)} alt="" />

      <div className="card__body">
        <p className="card__name">{asset.name}</p>

        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} ·{" "}
          {formatDate(asset.updatedAt)}
        </p>

        <span className={`pill pill--${asset.status}`}>
          {statusLabel(asset.status)}
        </span>
      </div>

      <input
        type="checkbox"
        className="card__check"
        checked={isSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={handleSelection}
      />
    </div>
  );
});

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
}: Props) {
  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">
          Clear the search box or widen the status filter.
        </p>
      </div>
    );
  }

  return (
    <div className="grid">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          isSelected={selectedIds.has(asset.id)}
          isActive={activeId === asset.id}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
