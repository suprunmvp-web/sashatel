"""Render initial site configuration into a new private directory."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import secrets


def private_ipv4(value):
    address = ipaddress.IPv4Address(value)
    networks = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
    if not any(address in ipaddress.IPv4Network(net) for net in networks):
        raise argparse.ArgumentTypeError("an RFC1918 IPv4 address is required")
    return str(address)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--bind", required=True, type=private_ipv4)
    parser.add_argument("--peer-1001", required=True, type=private_ipv4)
    parser.add_argument("--peer-1002", required=True, type=private_ipv4)
    args = parser.parse_args()
    if len({args.bind, args.peer_1001, args.peer_1002}) != 3:
        parser.error("assign distinct server and client addresses")

    values = {
        "BIND_IPV4": args.bind,
        "PEER_1001": args.peer_1001,
        "PEER_1002": args.peer_1002,
        "SECRET_1001": secrets.token_hex(32),
        "SECRET_1002": secrets.token_hex(32),
    }
    args.output.mkdir(mode=0o700)
    for template in sorted(Path(__file__).resolve().parent.glob("*.conf.example")):
        content = re.sub(r"@([A-Z0-9_]+)@", lambda match: values[match[1]],
                         template.read_text(encoding="utf-8"))
        with open(args.output / template.stem, "x", encoding="utf-8",
                  opener=private_file) as output:
            output.write(content)


def private_file(path, flags):
    return os.open(path, flags, 0o600)


if __name__ == "__main__":
    main()
