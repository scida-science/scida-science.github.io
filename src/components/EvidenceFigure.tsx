import { useEffect, useState } from "react";
import { usePortal } from "../state/PortalContext";
import type { EvidenceFigure as Figure } from "../types";

export default function EvidenceFigure({ discoveryId, figure, revision, expandable = false }: {
  discoveryId: string;
  figure: Figure;
  revision?: string;
  expandable?: boolean;
}) {
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
    {source && !failed ? <img src={source} alt={figure.alt} loading="lazy" onError={() => setFailed(true)} /> :
      <p className="muted">{failed ? "Figure unavailable. The caption remains available below." : "Loading evidence figure…"}</p>}
    <figcaption>{figure.caption}</figcaption>
    {expandable && source && !failed && <a className="figure-enlarge" href={source} target="_blank" rel="noopener noreferrer">
      Open full-size figure<span className="sr-only">: {figure.alt} (new tab)</span>
    </a>}
  </figure>;
}
