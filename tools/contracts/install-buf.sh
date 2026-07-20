#!/usr/bin/env sh
set -eu

version="1.72.0"
install_dir="${BUF_INSTALL_DIR:-${PWD}/.tools/bin}"
destination="${install_dir}/buf"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    asset="buf-Darwin-arm64"
    checksum="5176f23a6118b9978de1340c3e3301a4ed0d48e16a669510be44b4c355170d57"
    ;;
  Linux-x86_64)
    asset="buf-Linux-x86_64"
    checksum="8720830e26a733da55bb89bcd3cb44849c0965fc0c44fb5d691cccdc64dca5af"
    ;;
  *)
    echo "Unsupported platform for pinned Buf binary" >&2
    exit 1
    ;;
esac

if [ -x "${destination}" ] && [ "$("${destination}" --version)" = "${version}" ]; then
  exit 0
fi

mkdir -p "${install_dir}"
temporary="$(mktemp "${install_dir}/buf.XXXXXX")"
trap 'rm -f "${temporary}"' EXIT HUP INT TERM

curl --fail --silent --show-error --location \
  --output "${temporary}" \
  "https://github.com/bufbuild/buf/releases/download/v${version}/${asset}"

actual="$(shasum -a 256 "${temporary}" | cut -d ' ' -f 1)"
if [ "${actual}" != "${checksum}" ]; then
  echo "Pinned Buf checksum mismatch" >&2
  exit 1
fi

chmod +x "${temporary}"
mv "${temporary}" "${destination}"
trap - EXIT HUP INT TERM
