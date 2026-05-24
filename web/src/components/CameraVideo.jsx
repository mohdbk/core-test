import { Loader2, Radio, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { whepUrl } from "../api.js";

// Plays the camera's annotated WebRTC stream from MediaMTX. Re-opens the
// peer connection when `cameraId` changes; cleans up on unmount.
//
// Floating overlays on top of the video form a small HUD: live state +
// resolution, kept subtle so they don't fight with detection boxes.
export default function CameraVideo({ cameraId, onResolution }) {
  const videoRef = useRef(null);
  const pcRef    = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [resolution, setResolution] = useState(null);

  useEffect(() => {
    if (!cameraId) return;
    let cancelled = false;

    async function connect() {
      try { pcRef.current?.close(); } catch {}
      pcRef.current = null;
      const v = videoRef.current;
      if (v?.srcObject) {
        try { v.srcObject.getTracks().forEach((t) => t.stop()); } catch {}
        v.srcObject = null;
      }
      setStatus("connecting");

      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (e) => {
        if (!v || v.srcObject) return;
        v.srcObject = e.streams[0];
        v.play().catch(() => {});
      };
      pc.oniceconnectionstatechange = () => {
        if (cancelled || pc !== pcRef.current) return;
        const s = pc.iceConnectionState;
        if (s === "connected" || s === "completed") setStatus("live");
        else if (s === "failed" || s === "disconnected") {
          setStatus("error");
          setTimeout(() => { if (pc === pcRef.current && !cancelled) connect(); }, 1500);
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIce(pc, 1500);
        if (cancelled || pc !== pcRef.current) return;
        const res = await fetch(whepUrl(cameraId), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        const answer = await res.text();
        if (cancelled || pc !== pcRef.current) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (e) {
        if (cancelled || pc !== pcRef.current) return;
        setStatus("error");
        setTimeout(() => { if (pc === pcRef.current && !cancelled) connect(); }, 2000);
      }
    }

    connect();
    return () => {
      cancelled = true;
      try { pcRef.current?.close(); } catch {}
      pcRef.current = null;
    };
  }, [cameraId]);

  function handleMeta() {
    const v = videoRef.current;
    if (!v) return;
    setResolution({ w: v.videoWidth, h: v.videoHeight });
    onResolution?.(v.videoWidth, v.videoHeight);
  }

  return (
    <div className="absolute inset-0">
      <video
        ref={videoRef}
        onLoadedMetadata={handleMeta}
        autoPlay muted playsInline
        className="w-full h-full object-contain bg-black rounded-xl"
      />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pointer-events-none">
        <StatusHud status={status} />
        {resolution && status === "live" && (
          <span className="font-mono tabular-nums text-[10px] px-2 h-6 inline-flex items-center rounded-md
                           border border-white/10 bg-black/40 backdrop-blur-md text-subtle">
            {resolution.w}×{resolution.h}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusHud({ status }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[10px] font-mono font-semibold tracking-[0.16em]
                       text-rose-400 bg-black/40 border border-rose-500/40 backdrop-blur-md
                       shadow-[0_0_20px_-8px_rgba(244,63,94,.5)]">
        <Radio size={11} strokeWidth={2.25} className="animate-pulse-dot" />
        LIVE
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[10px] font-mono font-medium tracking-wider
                       text-amber-400 bg-black/40 border border-amber-500/40 backdrop-blur-md">
        <RefreshCcw size={11} strokeWidth={2} className="animate-spin" />
        RECONNECTING
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[10px] font-mono font-medium tracking-wider
                     text-subtle bg-black/40 border border-white/15 backdrop-blur-md">
      <Loader2 size={11} strokeWidth={2} className="animate-spin" />
      CONNECTING
    </span>
  );
}

function waitForIce(pc, timeoutMs) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(t); resolve(); };
    pc.addEventListener("icegatheringstatechange", check);
    const t = setTimeout(done, timeoutMs);
  });
}
