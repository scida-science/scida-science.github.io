import { ArrowUpRight, Orbit } from "lucide-react";
import type { Stage } from "../types";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-symbol">
        <Orbit size={26} strokeWidth={1.35} />
      </span>
      <span>
        <strong>
          SciDA<span className="brand-period">.</span>
        </strong>
        <span className="brand-description">Scientific Discovery Agent</span>
      </span>
    </span>
  );
}
export function StatusBadge({ status }: { status: Stage }) {
  return (
    <span
      className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function ExternalIcon() {
  return <ArrowUpRight size={15} aria-hidden="true" />;
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
export const stages: Stage[] = [
  "Awaiting Validation",
  "Validated",
  "Published",
];
