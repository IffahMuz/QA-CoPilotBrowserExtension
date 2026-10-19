import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Alert, Box, Button, CircularProgress, Typography,
} from "@mui/material";

const ext = typeof chrome !== "undefined" && chrome.runtime ? chrome : null;

type CapturePhase =
  | { name: "idle" }
  | { name: "busy"; label: string }
  | { name: "error"; message: string };

function RecordingDot() {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "#22c55e",
        mr: 0.75,
        animation: "qac-pulse 1.4s ease-in-out infinite",
        "@keyframes qac-pulse": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.3 },
        },
      }}
    />
  );
}

function App() {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>({ name: "idle" });

  // On mount: restore both recording state and any in-progress capture.
  useEffect(() => {
    if (!ext) return;
    ext.storage.session
      .get(["captureStatus", "recordingState"])
      .then((result: any) => {
        if (result.recordingState === "recording") setRecording(true);
        if (result.captureStatus) applyCaptureStatus(result.captureStatus);
      });
  }, []);

  // Live broadcasts from the service worker.
  useEffect(() => {
    if (!ext) return;
    const handler = (msg: any) => {
      if (msg.type === "CAPTURE_STATUS") applyCaptureStatus(msg.status);
      if (msg.type === "RECORDING_STATE") setRecording(msg.recording);
    };
    ext.runtime.onMessage.addListener(handler);
    return () => ext.runtime.onMessage.removeListener(handler);
  }, []);

  function applyCaptureStatus(s: any) {
    if (s.phase === "capturing") setCapturePhase({ name: "busy", label: "Freezing session…" });
    else if (s.phase === "uploading") setCapturePhase({ name: "busy", label: "Uploading evidence…" });
    else if (s.phase === "generating") setCapturePhase({ name: "busy", label: "Generating report with Claude…" });
    else if (s.phase === "idle") {
      ext?.storage.session.remove("captureStatus");
      setCapturePhase({ name: "idle" });
    } else if (s.phase === "error") {
      setCapturePhase({ name: "error", message: s.message });
    }
  }

  async function handleStartRecording() {
    setStarting(true);
    try {
      const resp: any = await ext?.runtime.sendMessage({ type: "START_RECORDING" });
      if (resp && !resp.ok) {
        setCapturePhase({ name: "error", message: resp.error ?? "Failed to start recording." });
      }
    } catch {
      setCapturePhase({ name: "error", message: "Could not contact the extension background." });
    } finally {
      setStarting(false);
    }
  }

  function handleStopRecording() {
    ext?.runtime.sendMessage({ type: "STOP_RECORDING" }).catch(() => {});
  }

  function handleCapture() {
    setCapturePhase({ name: "busy", label: "Freezing session…" });
    ext?.runtime.sendMessage({ type: "CAPTURE_BUG" });
  }

  const isBusy = capturePhase.name === "busy";
  const isError = capturePhase.name === "error";

  return (
    <Box sx={{ p: 2, width: 300 }}>

      {/* ── Header ── */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
          QA Copilot
        </Typography>
        {recording && (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <RecordingDot />
            <Typography variant="caption" sx={{ color: "#22c55e", fontWeight: 600 }}>
              Recording
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Not recording ── */}
      {!recording && !isBusy && !isError && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Navigate to the page, then start recording to capture a bug.
          </Typography>
          <Button
            variant="contained"
            fullWidth
            onClick={handleStartRecording}
            disabled={starting}
            sx={{ bgcolor: "#22c55e", "&:hover": { bgcolor: "#16a34a" } }}
          >
            {starting ? "Starting…" : "▶  Start Recording"}
          </Button>
        </>
      )}

      {/* ── Recording, idle ── */}
      {recording && !isBusy && !isError && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Reproduce the issue, then capture when the bug appears.
          </Typography>
          <Button
            variant="contained"
            color="error"
            fullWidth
            onClick={handleCapture}
            sx={{ mb: 1 }}
          >
            Capture Bug
          </Button>
          <Button
            variant="text"
            size="small"
            fullWidth
            onClick={handleStopRecording}
            sx={{ color: "text.disabled" }}
          >
            ■  Stop Recording
          </Button>
        </>
      )}

      {/* ── Busy (capture in progress) ── */}
      {isBusy && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <CircularProgress size={24} />
          <Typography>{(capturePhase as Extract<CapturePhase, { name: "busy" }>).label}</Typography>
        </Box>
      )}

      {/* ── Error ── */}
      {isError && (
        <>
          <Alert severity="error" sx={{ mb: 2 }}>
            {(capturePhase as Extract<CapturePhase, { name: "error" }>).message}
          </Alert>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => {
              ext?.storage.session.remove("captureStatus");
              setCapturePhase({ name: "idle" });
            }}
          >
            Try again
          </Button>
        </>
      )}

    </Box>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
