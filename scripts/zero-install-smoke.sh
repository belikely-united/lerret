#!/usr/bin/env bash
# scripts/zero-install-smoke.sh
#
# Zero-install smoke-test matrix.
#
# For each package runner available on the local machine, this script:
#   1. Packs create-lerret into a local tarball (simulates zero-install since
#      the package is not yet published to the npm registry).
#   2. Scaffolds a test project (full and --no-samples) via each runner.
#   3. Verifies the expected project tree and flag-forwarding.
#   4. Cleans up all smoke directories.
#
# A runner is SKIPPED (with a warning) when it is not installed on PATH.
# The script exits non-zero on any failure and prints a summary at the end.
#
# ── Local-tarball invocations ──────────────────────────────────────────────
#
# Because the packages are not yet on the npm registry we use `pnpm pack` to
# produce a .tgz archive. Each runner's invocation differs slightly:
#
#   npm (via `npm exec`):
#     npm exec --yes --package="<tgz>" -- create-lerret <name>
#     Note: the published user-facing command is `npx create-lerret@latest <name>`
#     (npx without --package finds the package from the registry). For local
#     tarballs, `npm exec --package` is the correct equivalent.
#
#   pnpm dlx:
#     pnpm dlx "<abs-tgz-path>" <name>
#     Note: requires the pnpm dlx cache to be cleared between versions of the
#     same tarball hash, since pnpm aggressively caches dlx packages. In CI
#     the cache is fresh on every run.
#
#   yarn dlx (Berry / Yarn 2+):
#     yarn dlx does NOT accept local file paths (it only accepts package names
#     from the registry). For local smoke we invoke the entry point directly
#     via `node`, which exercises the identical code path and verifies the
#     shebang portability. On CI with a published package, use:
#       yarn dlx create-lerret@latest <name>
#
#   bun (via `bunx`):
#     bunx in bun v1.x does not support local tarball paths (it interprets path
#     separators as scoped package prefixes). For local smoke we extract the
#     tarball and invoke via `bun run`, which exercises the same code path.
#     On CI with a published package, use:
#       bunx create-lerret@latest <name>
#
# ── Ports reserved for future dev-server smoke ────────────────────────────
#   npm  → 7801   pnpm → 7802   yarn → 7803   bun → 7804

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH_DIR="${REPO_ROOT}/.smoke-scratch"

# ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[smoke]${NC} $*"; }
ok()    { echo -e "${GREEN}[pass]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[skip]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; }

# ── State ──────────────────────────────────────────────────────────────────
PASS_RUNNERS=()
FAIL_RUNNERS=()
SKIP_RUNNERS=()

# ── Cleanup (idempotent) ───────────────────────────────────────────────────
cleanup_smoke_dirs() {
  rm -rf "${REPO_ROOT}/zero-install-smoke-"* 2>/dev/null || true
  rm -rf "${SCRATCH_DIR}" 2>/dev/null || true
}

cleanup_smoke_dirs  # always start clean
trap 'cleanup_smoke_dirs' EXIT

# ── Build local tarball ────────────────────────────────────────────────────
info "Packing create-lerret into a local tarball (simulates zero-install for unpublished package)..."
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

# Extract for runners that don't support local tarball paths (yarn, bun).
BUN_EXTRACT_DIR="${SCRATCH_DIR}/bun-extract"
mkdir -p "${BUN_EXTRACT_DIR}"
tar -xzf "${CREATE_TGZ}" -C "${BUN_EXTRACT_DIR}"
BUN_ENTRY="${BUN_EXTRACT_DIR}/package/src/create-lerret.js"

# ── Verify tarball bin field ───────────────────────────────────────────────
info "Verifying tarball structure and bin field..."
TMP_EXTRACT="${SCRATCH_DIR}/extract-verify"
mkdir -p "${TMP_EXTRACT}"
tar -xzf "${CREATE_TGZ}" -C "${TMP_EXTRACT}" package/package.json 2>/dev/null

BIN_FIELD="$(node -e "const p=require('${TMP_EXTRACT}/package/package.json'); console.log(JSON.stringify(p.bin))")"
info "create-lerret bin field in tarball: ${BIN_FIELD}"
if [[ "${BIN_FIELD}" != *"create-lerret"* ]]; then
  fail "create-lerret tarball missing bin.create-lerret — aborting."
  exit 1
fi
ok "tarball bin field is correct."

# ── Shebang + executable-bit audit ────────────────────────────────────────
info "Auditing shebangs and executable bits..."
SHEBANG_AUDIT_OK=1

for ENTRY_FILE in \
    "${REPO_ROOT}/packages/cli/src/lerret.js" \
    "${REPO_ROOT}/packages/create-lerret/src/create-lerret.js"
do
  SHEBANG="$(head -1 "${ENTRY_FILE}")"
  if [[ "${SHEBANG}" != "#!/usr/bin/env node" ]]; then
    fail "${ENTRY_FILE}: shebang is '${SHEBANG}', expected '#!/usr/bin/env node'"
    SHEBANG_AUDIT_OK=0
  else
    ok "${ENTRY_FILE}: shebang correct."
  fi

  # Check LF (no \r in shebang line) — portable across macOS and Linux.
  # Use od/awk instead of grep -P (which is GNU-only; macOS grep lacks -P).
  if head -c 30 "${ENTRY_FILE}" | od -c | grep -q '\\r'; then
    fail "${ENTRY_FILE}: shebang line has Windows (CRLF) line endings."
    SHEBANG_AUDIT_OK=0
  else
    ok "${ENTRY_FILE}: LF line endings confirmed."
  fi

  # Check executable bit
  if [[ ! -x "${ENTRY_FILE}" ]]; then
    fail "${ENTRY_FILE}: not executable (missing +x bit)."
    SHEBANG_AUDIT_OK=0
  else
    ok "${ENTRY_FILE}: executable bit set."
  fi
done

if [[ "${SHEBANG_AUDIT_OK}" -ne 1 ]]; then
  fail "Shebang/executable audit failed — aborting."
  exit 1
fi

# ── Helper: verify project tree ───────────────────────────────────────────
verify_full_tree() {
  local PROJ_DIR="$1"
  local RUNNER="$2"
  local TREE_OK=1
  for expected in \
      ".lerret/config.json" \
      ".lerret/social/twitter-banner.jsx" \
      ".lerret/social/instagram-square.jsx" \
      ".lerret/social/youtube-thumbnail.jsx" \
      ".lerret/_fonts/LerretFixtureMono.woff2" \
  ; do
    if [[ ! -f "${PROJ_DIR}/${expected}" ]]; then
      fail "${RUNNER}: missing expected file: ${expected}"
      TREE_OK=0
    fi
  done
  [[ "${TREE_OK}" -eq 1 ]]
}

verify_minimal_tree() {
  local PROJ_DIR="$1"
  local RUNNER="$2"
  if [[ ! -f "${PROJ_DIR}/.lerret/config.json" ]]; then
    fail "${RUNNER}: --no-samples: missing .lerret/config.json"
    return 1
  fi
  if [[ -d "${PROJ_DIR}/.lerret/social" ]]; then
    fail "${RUNNER}: --no-samples: social/ should not exist"
    return 1
  fi
  return 0
}

# ── Per-runner scaffold smoke ──────────────────────────────────────────────
# scaffold_full <runner> <proj_name> [-- extra args to runner...]
scaffold_full() {
  local RUNNER="$1"
  local PROJ_NAME="$2"
  case "${RUNNER}" in
    npm)
      # npm exec --package accepts a local .tgz path.
      # Published equivalent: npx create-lerret@latest <name>
      npm exec --yes --package="${CREATE_TGZ}" -- create-lerret "${PROJ_NAME}" \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    pnpm)
      # pnpm dlx accepts a local absolute .tgz path.
      # Published equivalent: pnpm dlx create-lerret@latest <name>
      pnpm dlx "${CREATE_TGZ}" "${PROJ_NAME}" \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    yarn)
      # yarn dlx does not accept local file paths (Berry limitation).
      # Published equivalent: yarn dlx create-lerret@latest <name>
      # Local equivalent: invoke the entry point via node (same code path).
      node "${REPO_ROOT}/packages/create-lerret/src/create-lerret.js" "${PROJ_NAME}" \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    bun)
      # bunx v1.x does not support local tarball paths.
      # Published equivalent: bunx create-lerret@latest <name>
      # Local equivalent: extract tarball, invoke entry via bun run.
      bun run "${BUN_ENTRY}" "${PROJ_NAME}" \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
  esac
}

scaffold_minimal() {
  local RUNNER="$1"
  local PROJ_NAME="$2"
  case "${RUNNER}" in
    npm)
      npm exec --yes --package="${CREATE_TGZ}" -- create-lerret "${PROJ_NAME}" --no-samples \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    pnpm)
      pnpm dlx "${CREATE_TGZ}" "${PROJ_NAME}" --no-samples \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    yarn)
      node "${REPO_ROOT}/packages/create-lerret/src/create-lerret.js" "${PROJ_NAME}" --no-samples \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
    bun)
      bun run "${BUN_ENTRY}" "${PROJ_NAME}" --no-samples \
        2>&1 | sed "s/^/  [${RUNNER}] /"
      ;;
  esac
}

run_smoke() {
  local RUNNER="$1"
  local PROJ_FULL="${REPO_ROOT}/zero-install-smoke-${RUNNER}"
  local PROJ_MIN="${REPO_ROOT}/zero-install-smoke-${RUNNER}-minimal"

  info "─── Runner: ${RUNNER} ───"

  # Check runner binary exists
  if ! command -v "${RUNNER}" &>/dev/null; then
    warn "${RUNNER} not found on PATH — skipping."
    SKIP_RUNNERS+=("${RUNNER}")
    return 0
  fi

  local RUNNER_FAIL=0

  # ── Full scaffold ────────────────────────────────────────────────────────
  info "${RUNNER}: scaffolding full project (with samples)..."
  if ! scaffold_full "${RUNNER}" "zero-install-smoke-${RUNNER}"; then
    fail "${RUNNER}: scaffold command exited non-zero."
    RUNNER_FAIL=1
  fi

  if [[ ! -d "${PROJ_FULL}" ]]; then
    fail "${RUNNER}: scaffold produced no project directory."
    RUNNER_FAIL=1
  elif ! verify_full_tree "${PROJ_FULL}" "${RUNNER}"; then
    RUNNER_FAIL=1
  else
    ok "${RUNNER}: full scaffold verified."
  fi
  rm -rf "${PROJ_FULL}" 2>/dev/null || true

  # ── Minimal scaffold (--no-samples flag forwarding) ──────────────────────
  info "${RUNNER}: verifying --no-samples flag forwarding..."
  scaffold_minimal "${RUNNER}" "zero-install-smoke-${RUNNER}-minimal" || true

  if [[ ! -d "${PROJ_MIN}" ]]; then
    fail "${RUNNER}: --no-samples produced no directory."
    RUNNER_FAIL=1
  elif ! verify_minimal_tree "${PROJ_MIN}" "${RUNNER}"; then
    RUNNER_FAIL=1
  else
    ok "${RUNNER}: --no-samples flag forwarding verified."
  fi
  rm -rf "${PROJ_MIN}" 2>/dev/null || true

  # ── Record result ────────────────────────────────────────────────────────
  if [[ "${RUNNER_FAIL}" -eq 0 ]]; then
    PASS_RUNNERS+=("${RUNNER}")
    ok "${RUNNER}: all checks passed."
  else
    FAIL_RUNNERS+=("${RUNNER}")
  fi
}

# ── Run matrix ─────────────────────────────────────────────────────────────
run_smoke "npm"
run_smoke "pnpm"
run_smoke "yarn"
run_smoke "bun"

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────"
echo " Zero-install smoke-test results"
echo "────────────────────────────────────────────────────────"

if [[ ${#PASS_RUNNERS[@]} -gt 0 ]]; then
  ok  "PASS: ${PASS_RUNNERS[*]}"
fi
if [[ ${#SKIP_RUNNERS[@]} -gt 0 ]]; then
  warn "SKIP: ${SKIP_RUNNERS[*]} (not installed)"
fi
if [[ ${#FAIL_RUNNERS[@]} -gt 0 ]]; then
  fail "FAIL: ${FAIL_RUNNERS[*]}"
fi

echo "────────────────────────────────────────────────────────"

if [[ ${#FAIL_RUNNERS[@]} -gt 0 ]]; then
  exit 1
fi
exit 0
