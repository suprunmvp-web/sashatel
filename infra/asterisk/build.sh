#!/usr/bin/env bash
set -euo pipefail
umask 022
version=22.12.0
base=https://downloads.asterisk.org/pub/telephony/asterisk
archive=asterisk-$version.tar.gz
stage=${1:?supply a new absolute staging directory}
[[ $EUID != 0 && $stage = /* && ! -e $stage ]]
mkdir -m 755 -- "$stage"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
curl --proto '=https' -fsSLO "$base/$archive"
curl --proto '=https' -fsSLo upstream.sha256 "$base/asterisk-$version.sha256"
sha256sum --check --strict upstream.sha256
sha256sum "$archive"
tar -xzf "$archive"
cd "asterisk-$version"
LDFLAGS="-Wl,-rpath,/opt/sashatel-asterisk/$version/lib" \
    ./configure --prefix="/opt/sashatel-asterisk/$version" --libdir="/opt/sashatel-asterisk/$version/lib" --with-pjproject-bundled --without-dahdi
make menuselect.makeopts
menuselect/menuselect --enable chan_pjsip --enable cdr_custom --enable cel_custom menuselect.makeopts
make -j2 NOISY_BUILD=yes
make DESTDIR="$stage" install
modules="$stage/opt/sashatel-asterisk/$version/lib/asterisk/modules"
for module in chan_pjsip res_pjsip res_pjsip_registrar res_rtp_asterisk app_dial cdr_custom cel_custom func_strings; do
    test -s "$modules/$module.so"
done

LD_LIBRARY_PATH="$stage/opt/sashatel-asterisk/$version/lib" \
    "$stage/opt/sashatel-asterisk/$version/sbin/asterisk" -V
