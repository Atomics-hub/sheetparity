#!/usr/bin/env bash
set -euo pipefail

VERSION="26.2.4"
BUILD_VERSION="26.2.4.2"
SHA256="810ef197e190d7804a60e0016052c46ff33792303a200fddda9d5216a64b9900"
URL="https://download.documentfoundation.org/libreoffice/stable/${VERSION}/deb/x86_64/LibreOffice_${VERSION}_Linux_x86-64_deb.tar.gz"
CACHE_DIR="${SHEETPARITY_ENGINE_CACHE:-${RUNNER_TEMP:-/tmp}/sheetparity-engine}"
ARCHIVE="${CACHE_DIR}/LibreOffice_${VERSION}_Linux_x86-64_deb.tar.gz"
EXTRACT_DIR="${CACHE_DIR}/${BUILD_VERSION}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "This installer is pinned for Linux x86_64. Install LibreOffice ${VERSION} separately and pass --soffice." >&2
  exit 2
fi

mkdir -p "${CACHE_DIR}"
if [[ ! -f "${ARCHIVE}" ]]; then
  curl --fail --location --retry 3 --output "${ARCHIVE}" "${URL}"
fi
printf '%s  %s\n' "${SHA256}" "${ARCHIVE}" | sha256sum --check --status

if [[ ! -d "${EXTRACT_DIR}" ]]; then
  mkdir -p "${EXTRACT_DIR}"
  tar -xzf "${ARCHIVE}" -C "${EXTRACT_DIR}" --strip-components=1
fi

if ! sudo dpkg --install "${EXTRACT_DIR}"/DEBS/*.deb >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install --fix-broken --yes
fi
SOFFICE="/opt/libreoffice26.2/program/soffice"
"${SOFFICE}" --headless --version

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'soffice=%s\n' "${SOFFICE}" >> "${GITHUB_OUTPUT}"
else
  printf '%s\n' "${SOFFICE}"
fi
