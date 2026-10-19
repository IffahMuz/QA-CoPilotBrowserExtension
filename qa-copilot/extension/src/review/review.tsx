import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Alert, Box, Button, Chip, CircularProgress, Container,
  CssBaseline, Divider, MenuItem, Stack, TextField, Typography,
} from "@mui/material";

const API_BASE = "http://localhost:8080";
const params = new URLSearchParams(window.location.search);
const REPORT_ID = parseInt(params.get("reportId") ?? "0", 10);
const STORAGE_KEY = `qa_draft_${REPORT_ID}`;

type Draft = {
  title: string;
  bugType: string;
  reproSteps: string[];
  expected: string;
  observations: string[];
  suspectedModule: string;
  severity: string;
  priority: string;
  assignedTeam: string;
  // Factual metadata — read-only in the form
  targetUrl?: string;
  environment?: string;
  dealerId?: string;
  dmsDealerId?: string;
};

const ENV_COLOR: Record<string, "warning" | "success" | "info" | "default"> = {
  Test: "warning",
  Production: "error" as any,
  Development: "info",
  Staging: "default",
};

function ReviewPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<{ id: number; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!REPORT_ID) {
      setError("No report ID in URL.");
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/reports/${REPORT_ID}/generate`, { method: "POST" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(async (serverDraft: Draft) => {
        // Overlay any locally-saved edits on top of the server draft
        const saved = await chrome.storage.local.get(STORAGE_KEY);
        setDraft(saved[STORAGE_KEY] ?? serverDraft);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const update = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      chrome.storage.local.set({ [STORAGE_KEY]: next });
      return next;
    });
  }, []);

  async function fileBug() {
    if (!draft) return;
    setFiling(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/reports/${REPORT_ID}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (res.ok) {
        await chrome.storage.local.remove(STORAGE_KEY);
        setFiled({ id: body.ado_work_item_id, url: body.url });
      } else {
        setError(body.error ?? "Filing failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setFiling(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 4 }}>
        <CircularProgress size={24} />
        <Typography>Loading bug report…</Typography>
      </Box>
    );
  }

  if (filed) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="success" sx={{ mb: 2 }}>
          Filed ADO bug #{filed.id} —{" "}
          <a href={filed.url} target="_blank" rel="noreferrer">
            open in Azure DevOps
          </a>
        </Alert>
        <Typography variant="body2" color="text.secondary">
          You can close this tab.
        </Typography>
      </Box>
    );
  }

  if (!draft) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {error ?? "No draft available"}
      </Alert>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" gutterBottom>
        Review Bug Report
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review and edit the AI-generated report before filing to Azure DevOps.
        All edits are auto-saved.
      </Typography>

      {/* Read-only metadata bar */}
      <Box sx={{ mb: 3, p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
        <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
          {draft.environment && (
            <Chip
              label={`ENV: ${draft.environment}`}
              color={ENV_COLOR[draft.environment] ?? "default"}
              size="small"
            />
          )}
          {draft.dealerId && (
            <Chip label={`Dealer ID: ${draft.dealerId}`} size="small" variant="outlined" />
          )}
          {draft.dmsDealerId && (
            <Chip label={`DMS Dealer: ${draft.dmsDealerId}`} size="small" variant="outlined" />
          )}
          {draft.targetUrl && (
            <Typography
              variant="caption"
              component="a"
              href={draft.targetUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ wordBreak: "break-all", color: "primary.main" }}
            >
              {draft.targetUrl}
            </Typography>
          )}
        </Stack>
      </Box>

      <Divider sx={{ mb: 3 }} />

      <Stack spacing={2.5}>
        <TextField
          label="Title"
          value={draft.title}
          fullWidth
          onChange={(e) => update("title", e.target.value)}
        />

        <TextField
          label="Repro Steps (one per line)"
          value={draft.reproSteps.join("\n")}
          onChange={(e) => update("reproSteps", e.target.value.split("\n"))}
          multiline
          minRows={5}
          fullWidth
          helperText="Each line becomes a numbered step in ADO"
        />

        <TextField
          label="Expected"
          value={draft.expected}
          multiline
          minRows={2}
          fullWidth
          onChange={(e) => update("expected", e.target.value)}
          helperText='Definitive resolved state — "I know this bug is resolved when: …"'
        />

        <TextField
          label="Observations (one per line)"
          value={draft.observations.join("\n")}
          onChange={(e) => update("observations", e.target.value.split("\n"))}
          multiline
          minRows={4}
          fullWidth
          helperText="Each line is one distinct fact — API status, console error, UI symptom"
        />

        <Stack direction="row" spacing={2} alignItems="flex-start">
          <TextField
            label="Suspected Module"
            value={draft.suspectedModule}
            sx={{ flex: 1 }}
            onChange={(e) => update("suspectedModule", e.target.value)}
          />
          <TextField
            select
            label="Bug Type"
            value={draft.bugType ?? "UI"}
            sx={{ flex: 1 }}
            onChange={(e) => update("bugType", e.target.value)}
          >
            {["API", "UI", "Both"].map((t) => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={2}>
          <TextField
            select
            label="Severity"
            value={draft.severity}
            sx={{ flex: 1 }}
            onChange={(e) => update("severity", e.target.value)}
          >
            {["Low", "Medium", "High", "Critical"].map((s) => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Priority"
            value={draft.priority}
            sx={{ flex: 1 }}
            onChange={(e) => update("priority", e.target.value)}
          >
            {["Low", "Medium", "High"].map((p) => (
              <MenuItem key={p} value={p}>{p}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="Assigned Team"
            value={draft.assignedTeam ?? ""}
            sx={{ flex: 1 }}
            onChange={(e) => update("assignedTeam", e.target.value)}
          />
        </Stack>

        {error && (
          <Alert severity="error">
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          disabled={filing}
          onClick={fileBug}
        >
          {filing ? "Filing to Azure DevOps…" : "File Bug"}
        </Button>
      </Stack>
    </Container>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CssBaseline />
    <ReviewPage />
  </React.StrictMode>
);
