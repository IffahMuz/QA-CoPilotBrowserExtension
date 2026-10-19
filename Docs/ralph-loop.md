# Ralph Loop - Agentic Development Pattern

Execute tasks iteratively following this cycle:

1. **Read** `progress.md` to see completed work and resume point.
2. **Select** the highest-priority incomplete task `[ ]` from `prd.md`.
3. **Implement** that single task following existing code patterns.
4. **Test** - Write/update unit tests for any logic.
5. **Verify** - Run `npm run build` (extension) and `dotnet build` (backend) and fix any failures.
6. **Update PRD** - Change `[ ]` to `[x]` for completed task.
7. **Update Progress** - Append to `progress.md`: task ID, files changed, summary.
8. **Loop or Complete** - If all tasks done, output `<promise>COMPLETE</promise>`. Otherwise, repeat from step 1.

## Rules
- ONE task per iteration
- ALWAYS update `progress.md` (your memory between iterations)
- NEVER commit failing code
- If stuck after 3 attempts: document blocker, skip to next task
- Read existing code before writing new code
- EVEN if a task is marked as completed in PRD and NOT STARTED in `progress.md`, treat it as NOT STARTED and proceed with implementation

## On Failure
- Compilation error → Fix and retry
- Test failure → Fix code or test, retry
- 3 failed attempts → Log in `progress.md`, move to next task
- `dotnet build` fails with MSB3021/MSB3027 ("file is locked by QaCopilot.Backend") → the backend is still running and holding `bin\Debug\net8.0\QaCopilot.Backend.exe`. This is NOT a compile error; the C# compiled fine. Stop the process on port 8080, then rebuild and restart. Backend code changes do NOT hot-reload — the server must be restarted or it keeps serving the old binary.
