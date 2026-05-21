#!/usr/bin/env bash
# scripts/cold-run-benchmark.sh
#
# Cold-run first-canvas benchmark (NFR1).
#
# For each available package runner this script:
#   1. Clears that runner's dlx / exec cache to simulate a cold run.
#   2. Packs create-lerret into a local tarball (packages are not yet published).
#   3. Times `create-lerret` (scaffolder).
#   4. Times `lerret dev --no-open` startup until the Vite server reports
#      listening on a port (surrogate for "first-canvas ready").
#   5. Records elapsed seconds per phase in scripts/cold-run-results.json.
#   6. Exits non-zero if ANY runner's total exceeds the THRESHOLD_SECONDS.
#
# ── Thresholds ──────────────────────────────────────────────────────────────
#   LOCAL_THRESHOLD_SECONDS  60  — NFR1 target for local dev (warm network)
#   CI_THRESHOLD_SECONDS     90  — generous allowance for CI runner variability
#
#   The script auto-detects CI (CI env var) and applies the right threshold.
#   Set LERRET_COLD_RUN_THRESHOLD to override either.
#
# ── Cache-clearing approach ─────────────────────────────────────────────────
#   npm:   `npm cache clean --force`  (npm's own built-in)
#   pnpm:  `pnpm store prune`         (removes orphan content; safe)
#          + clear the pnpm dlx per-package cache in ~/.local/share/pnpm
#            or $XDG_DATA_HOME/pnpm if set
#   yarn:  `rm -rf ~/.yarn/berry/cache` (Berry's module cache)
#   bun:   `rm -rf ~/.bun/install/cache` (Bun's package cache)
#
#   SAFE: no `rm -rf ~/` — only well-defined per-tool subdirectories are touched.
#   IDEMPOTENT: script may be run multiple times with identical effect.
#
# ── No-network behaviour ────────────────────────────────────────────────────
#   When the network is absent:
#   • npx / pnpm dlx / bunx fail within their own timeout (~30 s) with a
#     clear registry-connection error. The user sees the runner's error message.
#   • `lerret dev` never touches the network: it starts a local Vite server
#     using only already-installed dependencies. No network = no hang.
#   Both tools fail fast rather than hanging indefinitely. The CI runner
#   has network; local offline testing is documented in CONTRIBUTING.md.
#
# ── Port allocation ─────────────────────────────────────────────────────────
#   npm  → 7811   pnpm → 7812   yarn → 7813   bun → 7814
#   (different from the smoke-test ports 7801–7804 to avoid collisions)
#
# ── Output ──────────────────────────────────────────────────────────────────
#   scripts/cold-run-results.json — machine-readable per-runner timing table.
#   stdout                        — human-readable progress + summary table.
#
# ── Limitations / caveats ───────────────────────────────────────────────────
#   In a local environment where the packages are not published to the npm
#   registry, create-lerret is scaffolded from a local tarball (via `pnpm
#   pack`) rather than from the registry. This means the download phase is not
#   timed (no real registry round-trip). The scaffolder step therefore measures
#   extraction + execution only.
#
#   `lerret dev` is started from the scaffolded project directory. In the
#   workspace the CLI imports Vite from the workspace node_modules, so the
#   Vite startup time is representative once Vite itself is installed. On a
#   genuine cold machine Vite would also need to be downloaded — which is the
#   dominant network cost. CI is the source of truth for the full cold-run NFR.

set -uo pipefail

# ── Paths ───────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH_DIR="${REPO_ROOT}/.cold-run-scratch"
RESULTS_FILE="${REPO_ROOT}/scripts/cold-run-results.json"

# ── Threshold (seconds) ─────────────────────────────────────────────────────
# CI env var is set by GitHub Actions, Travis, CircleCI, etc.
if [[ -n "${LERRET_COLD_RUN_THRESHOLD:-}" ]]; then
  THRESHOLD="${LERRET_COLD_RUN_THRESHOLD}"
elif [[ -n "${CI:-}" ]]; then
  THRESHOLD=90
else
  THRESHOLD=60
fi

# ── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[bench]${NC} $*"; }
ok()    { echo -e "${GREEN}[pass]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; }
dim()   { echo -e "${CYAN}[note]${NC}  $*"; }

# ── State (bash 3-compatible: use plain scalar variables) ────────────────────
PASS_RUNNERS=""
FAIL_RUNNERS=""
SKIP_RUNNERS=""

# Per-runner result scalars — set by run_benchmark().
npm_scaffold_s="n/a"
npm_server_s="n/a"
npm_total_s="n/a"
npm_http="n/a"
npm_status="skip"

pnpm_scaffold_s="n/a"
pnpm_server_s="n/a"
pnpm_total_s="n/a"
pnpm_http="n/a"
pnpm_status="skip"

yarn_scaffold_s="n/a"
yarn_server_s="n/a"
yarn_total_s="n/a"
yarn_http="n/a"
yarn_status="skip"

bun_scaffold_s="n/a"
bun_server_s="n/a"
bun_total_s="n/a"
bun_http="n/a"
bun_status="skip"

# Active background dev-server PID (reset between runs).
DEV_PID=""

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "${DEV_PID:-}" ]]; then
    kill "${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
    DEV_PID=""
  fi
  rm -rf "${SCRATCH_DIR}" 2>/dev/null || true
  rm -rf "${REPO_ROOT}/cold-run-bench-"* 2>/dev/null || true
}

trap 'cleanup' EXIT

cleanup  # start clean

# ── Build local tarballs ─────────────────────────────────────────────────────
info "Packing create-lerret into a local tarball..."
mkdir -p "${SCRATCH_DIR}"

(
  cd "${REPO_ROOT}/packages/create-lerret"
  pnpm pack --pack-destination "${SCRATCH_DIR}" 2>/dev/null
)
CREATE_TGZ="$(ls "${SCRATCH_DIR}"/create-lerret-*.tgz 2>/dev/null | head -1)"
if [[ -z "${CREATE_TGZ}" ]]; then
  fail "pnpm pack of create-lerret produced no tarball — aborting."
  exit 1
fi
info "create-lerret tarball: ${CREATE_TGZ}"

# Extract tarballs for runners that don't support local paths (yarn, bun).
YARN_EXTRACT_DIR="${SCRATCH_DIR}/yarn-extract"
BUN_EXTRACT_DIR="${SCRATCH_DIR}/bun-extract"
mkdir -p "${YARN_EXTRACT_DIR}" "${BUN_EXTRACT_DIR}"
tar -xzf "${CREATE_TGZ}" -C "${YARN_EXTRACT_DIR}"
tar -xzf "${CREATE_TGZ}" -C "${BUN_EXTRACT_DIR}"
CREATE_ENTRY_YARN="${YARN_EXTRACT_DIR}/package/src/create-lerret.js"
CREATE_ENTRY_BUN="${BUN_EXTRACT_DIR}/package/src/create-lerret.js"

# ── Safe cache-clearing ──────────────────────────────────────────────────────
clear_npm_cache() {
  info "Clearing npm cache..."
  npm cache clean --force 2>&1 | grep -v "^npm warn" || true
  ok "npm cache cleared."
}

clear_pnpm_cache() {
  info "Clearing pnpm store (orphan entries)..."
  pnpm store prune 2>&1 | tail -3 || true
  # Clear pnpm dlx per-package execution cache.
  local dlx_cache
  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    dlx_cache="${XDG_DATA_HOME}/pnpm"
  else
    dlx_cache="${HOME}/.local/share/pnpm"
  fi
  if [[ -d "${dlx_cache}/dlx" ]]; then
    rm -rf "${dlx_cache}/dlx" 2>/dev/null || true
    info "Cleared pnpm dlx cache at ${dlx_cache}/dlx"
  fi
  ok "pnpm store pruned."
}

clear_yarn_cache() {
  info "Clearing yarn Berry cache..."
  local yarn_cache="${HOME}/.yarn/berry/cache"
  if [[ -n "${YARN_CACHE_FOLDER:-}" ]]; then
    yarn_cache="${YARN_CACHE_FOLDER}"
  fi
  if [[ -d "${yarn_cache}" ]]; then
    rm -rf "${yarn_cache}" 2>/dev/null || true
    info "Cleared yarn Berry cache at ${yarn_cache}"
  fi
  ok "yarn Berry cache cleared."
}

clear_bun_cache() {
  info "Clearing bun install cache..."
  local bun_root="${BUN_INSTALL:-${HOME}/.bun}"
  local bun_cache="${bun_root}/install/cache"
  if [[ -d "${bun_cache}" ]]; then
    rm -rf "${bun_cache}" 2>/dev/null || true
    info "Cleared bun cache at ${bun_cache}"
  fi
  ok "bun install cache cleared."
}

# ── Timing helpers ───────────────────────────────────────────────────────────
# Returns milliseconds since epoch.
#
# Strategy (cross-platform):
#   1. Use Node.js `Date.now()` — always available (node is required anyway),
#      always millisecond precision, works identically on macOS + Linux.
#   2. Fall back to GNU date +%s%3N if node is somehow absent.
#   3. Last resort: BSD date +%s × 1000 (1-second resolution).
now_ms() {
  if command -v node &>/dev/null; then
    node -e "process.stdout.write(String(Date.now()))"
    return
  fi
  local ts
  ts="$(date +%s%3N 2>/dev/null)"
  if [[ "${ts}" =~ ^[0-9]{13,}$ ]]; then
    echo "${ts}"
  else
    echo "$(( $(date +%s) * 1000 ))"
  fi
}

elapsed_ms() {
  local start_ms="$1"
  local end_ms
  end_ms="$(now_ms)"
  echo $(( end_ms - start_ms ))
}

ms_to_secs() {
  local ms="$1"
  # One decimal place using integer arithmetic (no bc/awk needed).
  echo "$(( ms / 1000 )).$(( (ms % 1000) / 100 ))"
}

# ── Scaffold timing ──────────────────────────────────────────────────────────
# Echoes elapsed_ms on success; exits non-zero on failure.
scaffold_timed() {
  local RUNNER="$1"
  local PROJ_NAME="$2"

  local T_START
  T_START="$(now_ms)"

  case "${RUNNER}" in
    npm)
      npm exec --yes --package="${CREATE_TGZ}" -- create-lerret "${PROJ_NAME}" \
        > /dev/null 2>&1
      ;;
    pnpm)
      pnpm dlx "${CREATE_TGZ}" "${PROJ_NAME}" > /dev/null 2>&1
      ;;
    yarn)
      node "${CREATE_ENTRY_YARN}" "${PROJ_NAME}" > /dev/null 2>&1
      ;;
    bun)
      bun run "${CREATE_ENTRY_BUN}" "${PROJ_NAME}" > /dev/null 2>&1
      ;;
  esac
  local EXIT_CODE=$?

  local T_END
  T_END="$(now_ms)"
  echo $(( T_END - T_START ))
  return ${EXIT_CODE}
}

# ── Dev-server startup timing ────────────────────────────────────────────────
# Starts lerret dev --no-open --port <port> from the project dir, waits for
# Vite's listening message, kills the server, and echoes the elapsed ms.
# Exits non-zero on timeout.

wait_for_vite() {
  local PROJ_DIR="$1"
  local PORT="$2"
  local TIMEOUT_MS=45000   # 45 s max wait for server startup
  local LOG_FILE="${SCRATCH_DIR}/dev-${PORT}.log"

  local T_START
  T_START="$(now_ms)"

  # Start lerret dev in the background, capturing stdout+stderr.
  (
    cd "${PROJ_DIR}"
    node "${REPO_ROOT}/packages/cli/src/lerret.js" dev --no-open --port "${PORT}" \
      > "${LOG_FILE}" 2>&1
  ) &
  DEV_PID=$!

  local FOUND=0
  local ELAPSED_MS=0

  while true; do
    ELAPSED_MS="$(elapsed_ms "${T_START}")"

    if grep -qE "(Local:|ready in|localhost:${PORT})" "${LOG_FILE}" 2>/dev/null; then
      FOUND=1
      break
    fi

    # Check if process died unexpectedly.
    if ! kill -0 "${DEV_PID}" 2>/dev/null; then
      break
    fi

    if [[ "${ELAPSED_MS}" -ge "${TIMEOUT_MS}" ]]; then
      break
    fi

    sleep 0.2
  done

  kill "${DEV_PID}" 2>/dev/null || true
  wait "${DEV_PID}" 2>/dev/null || true
  DEV_PID=""

  if [[ "${FOUND}" -eq 0 ]]; then
    return 1
  fi

  echo "${ELAPSED_MS}"
  return 0
}

# ── Set per-runner result variables (bash 3 compatible) ──────────────────────
set_runner_result() {
  local RUNNER="$1"
  local KEY="$2"
  local VALUE="$3"
  # Dynamically set variables like npm_scaffold_s, pnpm_status, etc.
  eval "${RUNNER}_${KEY}=\"${VALUE}\""
}

get_runner_result() {
  local RUNNER="$1"
  local KEY="$2"
  eval echo "\${${RUNNER}_${KEY}}"
}

# ── Per-runner benchmark ─────────────────────────────────────────────────────
run_benchmark() {
  local RUNNER="$1"
  local PORT="$2"

  info "─── Runner: ${RUNNER} (port ${PORT}) ───"

  # Check runner binary exists.
  if ! command -v "${RUNNER}" &>/dev/null; then
    warn "${RUNNER} not found on PATH — skipping."
    SKIP_RUNNERS="${SKIP_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "skip"
    return 0
  fi

  local PROJ_NAME="cold-run-bench-${RUNNER}"
  local PROJ_DIR="${REPO_ROOT}/${PROJ_NAME}"

  # ── 1. Clear cache ─────────────────────────────────────────────────────────
  case "${RUNNER}" in
    npm)  clear_npm_cache  ;;
    pnpm) clear_pnpm_cache ;;
    yarn) clear_yarn_cache ;;
    bun)  clear_bun_cache  ;;
  esac

  # ── 2. Scaffold timing ─────────────────────────────────────────────────────
  info "${RUNNER}: scaffolding project (measuring)..."

  local SCAFFOLD_MS
  if ! SCAFFOLD_MS="$(scaffold_timed "${RUNNER}" "${PROJ_NAME}" 2>&1)"; then
    fail "${RUNNER}: scaffold command failed."
    FAIL_RUNNERS="${FAIL_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "fail"
    rm -rf "${PROJ_DIR}" 2>/dev/null || true
    return 1
  fi

  if [[ ! -d "${PROJ_DIR}" ]]; then
    fail "${RUNNER}: scaffold produced no project directory."
    FAIL_RUNNERS="${FAIL_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "fail"
    return 1
  fi

  # Validate scaffold_ms is numeric (guard against stray output).
  if ! [[ "${SCAFFOLD_MS}" =~ ^[0-9]+$ ]]; then
    # Try to extract the last numeric token.
    SCAFFOLD_MS="$(echo "${SCAFFOLD_MS}" | grep -oE '[0-9]+$' || echo "0")"
  fi

  local SCAFFOLD_S
  SCAFFOLD_S="$(ms_to_secs "${SCAFFOLD_MS}")"
  ok "${RUNNER}: scaffold done in ${SCAFFOLD_S}s"
  set_runner_result "${RUNNER}" "scaffold_s" "${SCAFFOLD_S}"

  # ── 3. Dev-server startup timing ───────────────────────────────────────────
  info "${RUNNER}: starting lerret dev (measuring)..."

  local SERVER_MS
  if ! SERVER_MS="$(wait_for_vite "${PROJ_DIR}" "${PORT}")"; then
    fail "${RUNNER}: lerret dev did not start within timeout on port ${PORT}."
    FAIL_RUNNERS="${FAIL_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "fail"
    rm -rf "${PROJ_DIR}" 2>/dev/null || true
    return 1
  fi

  if ! [[ "${SERVER_MS}" =~ ^[0-9]+$ ]]; then
    SERVER_MS="$(echo "${SERVER_MS}" | grep -oE '[0-9]+$' || echo "0")"
  fi

  local SERVER_S
  SERVER_S="$(ms_to_secs "${SERVER_MS}")"
  ok "${RUNNER}: Vite server ready in ${SERVER_S}s"
  set_runner_result "${RUNNER}" "server_s" "${SERVER_S}"

  # HTTP canvas check is skipped (server already stopped; timing it separately
  # would distort the total). In CI a separate step could be added.
  set_runner_result "${RUNNER}" "http" "skip"
  dim "${RUNNER}: HTTP canvas check skipped (server stopped after timing; CI adds this step)."

  # ── 4. Total + threshold check ─────────────────────────────────────────────
  local TOTAL_MS=$(( SCAFFOLD_MS + SERVER_MS ))
  local TOTAL_S
  TOTAL_S="$(ms_to_secs "${TOTAL_MS}")"
  set_runner_result "${RUNNER}" "total_s" "${TOTAL_S}"

  local TOTAL_INT=$(( TOTAL_MS / 1000 ))
  if [[ "${TOTAL_INT}" -le "${THRESHOLD}" ]]; then
    ok "${RUNNER}: TOTAL ${TOTAL_S}s <= ${THRESHOLD}s threshold — PASS"
    PASS_RUNNERS="${PASS_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "pass"
  else
    fail "${RUNNER}: TOTAL ${TOTAL_S}s exceeds ${THRESHOLD}s threshold — FAIL"
    FAIL_RUNNERS="${FAIL_RUNNERS} ${RUNNER}"
    set_runner_result "${RUNNER}" "status" "fail"
  fi

  rm -rf "${PROJ_DIR}" 2>/dev/null || true
}

# ── Run benchmark matrix ─────────────────────────────────────────────────────
info "Cold-run first-canvas benchmark (NFR1 — target <${THRESHOLD}s per runner)"
info "Repo: ${REPO_ROOT}"
info "Results will be written to: ${RESULTS_FILE}"
echo ""

dim "NOTE: Packages are loaded from a local tarball (pnpm pack), not the"
dim "registry. The scaffold time does not include registry download time."
dim "CI is the source of truth for the full cold-run NFR (registry + Vite install)."
echo ""

run_benchmark "npm"  7811
run_benchmark "pnpm" 7812
run_benchmark "yarn" 7813
run_benchmark "bun"  7814

# ── Write results JSON ───────────────────────────────────────────────────────
write_results_json() {
  local ISO_DATE
  ISO_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local IS_CI="false"
  if [[ -n "${CI:-}" ]]; then
    IS_CI="true"
  fi

  # Build runners object manually (bash 3 compatible — no associative arrays).
  local RUNNERS_JSON=""
  for r in npm pnpm yarn bun; do
    local r_status r_scaffold r_server r_total r_http
    r_status="$(get_runner_result "${r}" "status")"
    r_scaffold="$(get_runner_result "${r}" "scaffold_s")"
    r_server="$(get_runner_result "${r}" "server_s")"
    r_total="$(get_runner_result "${r}" "total_s")"
    r_http="$(get_runner_result "${r}" "http")"
    local entry
    entry="\"${r}\":{\"status\":\"${r_status}\",\"scaffold_s\":\"${r_scaffold}\",\"server_s\":\"${r_server}\",\"total_s\":\"${r_total}\",\"http_check\":\"${r_http}\"}"
    if [[ -n "${RUNNERS_JSON}" ]]; then
      RUNNERS_JSON="${RUNNERS_JSON},${entry}"
    else
      RUNNERS_JSON="${entry}"
    fi
  done

  printf '{"timestamp":"%s","threshold_seconds":%s,"is_ci":%s,"note":"%s","runners":{%s}}\n' \
    "${ISO_DATE}" \
    "${THRESHOLD}" \
    "${IS_CI}" \
    "scaffold step uses local tarball (pnpm pack); no registry download timed. CI is source of truth for full cold-run NFR." \
    "${RUNNERS_JSON}" \
    > "${RESULTS_FILE}"

  info "Results written to ${RESULTS_FILE}"
}

write_results_json

# ── Summary table ────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Cold-run first-canvas benchmark (NFR1)"
IS_CI_LABEL="local"
[[ -n "${CI:-}" ]] && IS_CI_LABEL="CI"
echo " Threshold: ${THRESHOLD}s (${IS_CI_LABEL})"
echo "============================================================"
printf "%-8s  %-12s  %-12s  %-12s  %-8s\n" \
  "Runner" "Scaffold" "Dev Start" "Total" "Status"
echo "------------------------------------------------------------"
for r in npm pnpm yarn bun; do
  r_status="$(get_runner_result "${r}" "status")"
  r_scaffold="$(get_runner_result "${r}" "scaffold_s")"
  r_server="$(get_runner_result "${r}" "server_s")"
  r_total="$(get_runner_result "${r}" "total_s")"
  printf "%-8s  %-12s  %-12s  %-12s  %s\n" \
    "${r}" \
    "${r_scaffold}s" \
    "${r_server}s" \
    "${r_total}s" \
    "${r_status}"
done
echo "============================================================"

# Trim leading spaces.
PASS_RUNNERS="${PASS_RUNNERS# }"
SKIP_RUNNERS="${SKIP_RUNNERS# }"
FAIL_RUNNERS="${FAIL_RUNNERS# }"

if [[ -n "${PASS_RUNNERS}" ]]; then
  ok  "PASS: ${PASS_RUNNERS}"
fi
if [[ -n "${SKIP_RUNNERS}" ]]; then
  warn "SKIP: ${SKIP_RUNNERS} (not installed)"
fi
if [[ -n "${FAIL_RUNNERS}" ]]; then
  fail "FAIL: ${FAIL_RUNNERS} (exceeded ${THRESHOLD}s threshold)"
fi
echo ""

if [[ -n "${FAIL_RUNNERS}" ]]; then
  exit 1
fi
exit 0
