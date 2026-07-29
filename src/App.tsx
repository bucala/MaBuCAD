import { useEffect } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { useRebuild } from "@/hooks/useRebuild";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";

export default function App() {
  useRebuild();

  // Rebuild failures belong on the feature that caused them, so the tree can badge it.
  const errors = useGeometryStore((state) => state.errors);
  const setFeatureErrors = useDocumentStore((state) => state.setFeatureErrors);

  useEffect(() => {
    setFeatureErrors(errors);
  }, [errors, setFeatureErrors]);

  return <AppShell />;
}
