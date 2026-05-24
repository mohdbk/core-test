import { Camera, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api.js";

export default function AddCameraDialog({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !source.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const cam = await api.createCamera({
        name: name.trim(),
        source: source.trim(),
        image_width: 1280,
        image_height: 720,
      });
      onCreated?.(cam);
    } catch (e) {
      setError(e.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <form
        onSubmit={submit}
        className="surface-strong rounded-2xl p-5 w-[460px] max-w-[92vw] space-y-4 animate-slide-up"
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 grid place-items-center rounded-lg bg-cyan-400/10 border border-cyan-400/20">
              <Camera size={14} strokeWidth={1.75} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold">Add camera</h2>
              <p className="text-[11px] text-subtle">UUID assigned automatically</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn h-7 w-7 p-0" aria-label="Close">
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-1.5">
          <div className="label">Display name</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Front entrance"
            className="input"
          />
        </div>

        <div className="space-y-1.5">
          <div className="label">Upstream RTSP source</div>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="rtsp://host:554/path"
            className="input font-mono"
          />
          <p className="text-[11px] text-subtle leading-relaxed">
            The ai-engine pulls from this URL, draws boxes, and publishes back to MediaMTX as{" "}
            <span className="font-mono text-cyan-400">{`<uuid>-annotated`}</span>.
          </p>
        </div>

        {error && (
          <div className="text-rose-400 text-xs px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-md">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Creating…" : "Create camera"}
          </button>
        </footer>
      </form>
    </div>
  );
}
