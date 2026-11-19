"""Require the configured WireGuard address and both peer routes."""
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys


def ip_json(*arguments):
    return json.loads(subprocess.check_output(["/usr/sbin/ip", "-j", *arguments]))


def check(config):
    bind = re.findall(r"^bind=([0-9.]+):5060$", config, re.M)
    peers = re.findall(r"^permit=([0-9.]+)/32$", config, re.M)
    if len(bind) != 1 or len(peers) != 2:
        raise ValueError("expected one SIP address and two VPN peers")
    source, *peers = map(str, map(ipaddress.IPv4Address, bind + peers))
    if len({source, *peers}) != 3:
        raise ValueError("duplicate VPN addresses")
    links = ip_json("-d", "link", "show", "dev", "wg0")
    if (len(links) != 1 or "UP" not in links[0]["flags"]
            or links[0].get("linkinfo", {}).get("info_kind") != "wireguard"):
        raise ValueError("wg0 must be an active WireGuard link")
    addresses = ip_json("-4", "addr", "show", "dev", "wg0")
    if not any(info.get("local") == source for link in addresses
               for info in link.get("addr_info", [])):
        raise ValueError("SIP address is absent from wg0")
    for peer in peers:
        routes = ip_json("-4", "route", "get", peer, "from", source)
        if len(routes) != 1 or routes[0].get("dev") != "wg0":
            raise ValueError("peer route does not use wg0")


if __name__ == "__main__":
    try:
        check(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(f"VPN preflight failed: {error}")
