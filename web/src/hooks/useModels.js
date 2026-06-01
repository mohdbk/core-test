import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// Single source of truth for the installed inference models. Refetches when
// `refresh()` is called explicitly (the common case is after a POST to
// /api/models from the settings UI). The list is small and rarely changes,
// so we don't poll.
export function useModels() {
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState("loading");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const ms = await api.listModels();
      setModels(ms);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { models, status, refresh };
}

// Convenience: filter models by detector kind ("object" | "ppe" | "pose").
export function modelsForKind(models, kind) {
  return (models || []).filter((m) => m.kind === kind);
}
