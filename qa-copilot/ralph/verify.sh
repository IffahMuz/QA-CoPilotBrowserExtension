#!/usr/bin/env bash
set -euo pipefail
( cd extension && npm run build )            # extension compiles
( cd backend   && dotnet build -c Release )  # backend compiles
# task-specific checks appended here as the build grows (e.g. dotnet test)
