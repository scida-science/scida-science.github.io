import { useEffect, useState } from "react";
import { usePortal } from "../state/PortalContext";
import type { EvidenceFigure as Figure } from "../types";

export default function EvidenceFigure({ discoveryId, figure, revision }: { discoveryId: string; figure: Figure; revision?: string }) {
  const { loadFigure, user } = usePortal();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setSource(null);
    setFailed(false);
    void loadFigure(discoveryId, figure.id).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSource(url);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [discoveryId, figure.id, figure.path, revision, loadFigure, user?.id]);
  return <figure className="evidence-figure">
    {source ? <img src={source} alt={figure.alt} loading="lazy" /> :
      <p className="muted">{failed ? "Figure unavailable. The caption remains available below." : "Loading evidence figure…"}</p>}
    <figcaption>{figure.caption}</figcaption>
  </figure>;
}
