import { useEffect, useState } from "react";
import {
  Box, Button, MenuItem, Stack, TextField, Typography,
} from "@mui/material";

type Draft = {
  title: string;
  reproSteps: string[];
  expected: string;
  actual: string;
  consoleErrorSummary: string;
  failedApiSummary: string;
  environmentSummary: string;
  suspectedModule: string;
  severity: string;
  priority: string;
  assignedTeam?: string;
};

export function ReviewScreen({
  reportId,
  apiBase,
}: {
  reportId: number;
  apiBase: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<{ id: number; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/reports/${reportId}/generate`, { method: "POST" })
      .then((r) => r.json())
      .then(setDraft)
      .catch((e) => setError(String(e)));
  }, [reportId, apiBase]);

  const set =
    (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((d) => ({ ...d!, [k]: e.target.value }));

  async function fileBug() {
    if (!draft) return;
    setFiling(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/reports/${reportId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (res.ok) {
        setFiled({ id: body.ado_work_item_id, url: body.url });
      } else {
        setError(body.error ?? "File failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setFiling(false);
    }
  }

  if (filed)
    return (
      <Typography sx={{ p: 2 }}>
        Filed ADO bug #{filed.id} —{" "}
        <a href={filed.url} target="_blank" rel="noreferrer">
          open
        </a>
      </Typography>
    );

  if (!draft)
    return (
      <Typography sx={{ p: 2 }}>
        {error ?? "Generating report…"}
      </Typography>
    );

  return (
    <Box sx={{ p: 2, width: 480 }}>
      <Stack spacing={1.5}>
        <TextField label="Title" value={draft.title} onChange={set("title")} fullWidth />
        <TextField
          label="Repro steps"
          value={draft.reproSteps.join("\n")}
          onChange={(e) =>
            setDraft((d) => ({ ...d!, reproSteps: e.target.value.split("\n") }))
          }
          multiline
          minRows={4}
          fullWidth
        />
        <TextField label="Expected" value={draft.expected} onChange={set("expected")} multiline fullWidth />
        <TextField label="Actual" value={draft.actual} onChange={set("actual")} multiline fullWidth />
        <TextField label="Console summary" value={draft.consoleErrorSummary} onChange={set("consoleErrorSummary")} multiline fullWidth />
        <TextField label="Failed API summary" value={draft.failedApiSummary} onChange={set("failedApiSummary")} multiline fullWidth />
        <TextField label="Environment summary" value={draft.environmentSummary} onChange={set("environmentSummary")} multiline fullWidth />
        <TextField label="Suspected module" value={draft.suspectedModule} onChange={set("suspectedModule")} fullWidth />
        <TextField select label="Severity" value={draft.severity} onChange={set("severity")}>
          {["Low", "Medium", "High", "Critical"].map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </TextField>
        <TextField select label="Priority" value={draft.priority} onChange={set("priority")}>
          {["Low", "Medium", "High"].map((p) => (
            <MenuItem key={p} value={p}>{p}</MenuItem>
          ))}
        </TextField>
        <TextField
          label="Assigned team"
          value={draft.assignedTeam ?? ""}
          onChange={set("assignedTeam")}
          fullWidth
        />
        {error && <Typography color="error">{error}</Typography>}
        <Button variant="contained" disabled={filing} onClick={fileBug}>
          {filing ? "Filing…" : "File Bug"}
        </Button>
      </Stack>
    </Box>
  );
}
