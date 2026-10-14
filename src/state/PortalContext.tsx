import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getBackend } from "../lib/supabase";
import {
  createPortalService,
  type PortalService,
} from "../services/portalService";

const PortalContext = createContext<PortalService | null>(null);

export function PortalProvider({
  children,
  service: suppliedService,
}: {
  children: ReactNode;
  service?: PortalService;
}) {
  const [service] = useState(() => {
    if (suppliedService) return suppliedService;
    const backend = getBackend();
    return createPortalService(backend.client, backend.error);
  });
  useEffect(() => {
    void service.start();
    return () => service.stop();
  }, [service]);
  return (
    <PortalContext.Provider value={service}>{children}</PortalContext.Provider>
  );
}

export function usePortal() {
  const service = useContext(PortalContext);
  if (!service) throw new Error("usePortal must be used within PortalProvider");
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  return { ...snapshot, ...service.actions };
}
