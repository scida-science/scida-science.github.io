import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import type { Profile } from "../types";
import "./AccountMenu.css";

export default function AccountMenu({ user, signingOut, onSignOut }: {
  user: Profile;
  signingOut: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const initialFocus = useRef<"first" | "last" | null>(null);
  const panelId = useId();
  const location = useLocation();
  const name = user.fullName || user.githubLogin || "My account";

  function focusItem(position: "first" | "last") {
    const items = panel.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)");
    if (items?.length) items[position === "first" ? 0 : items.length - 1].focus();
  }
  useEffect(() => { setOpen(false); }, [location.key, user.id]);
  useEffect(() => {
    if (!open) return;
    if (initialFocus.current) {
      focusItem(initialFocus.current);
      initialFocus.current = null;
    }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function navigateItems(event: KeyboardEvent<HTMLElement>) {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? [])];
    if (!items.length) return;
    let next = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") next = (next + 1) % items.length;
    else if (event.key === "ArrowUp") next = (next - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  }

  return <div className="account-menu" ref={container}>
    <button className="account-menu-trigger" ref={trigger} type="button"
      aria-label={`Account menu for ${name}`} aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const position = event.key === "ArrowDown" ? "first" : "last";
        if (open) focusItem(position);
        else { initialFocus.current = position; setOpen(true); }
      }}>
      <span className="account-menu-identity"><span>{name}</span><small>{user.role}</small></span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <nav className="account-menu-panel" id={panelId} ref={panel} aria-label="Account" onKeyDown={navigateItems}>
      <Link to="/profile" onClick={() => setOpen(false)}><UserRound size={17} aria-hidden="true" />My profile</Link>
      <Link to="/access" onClick={() => setOpen(false)}><ShieldCheck size={17} aria-hidden="true" />Reviewer access</Link>
      <button type="button" disabled={signingOut} onClick={() => void onSignOut()}>
        <LogOut size={17} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}
      </button>
    </nav>}
  </div>;
}
