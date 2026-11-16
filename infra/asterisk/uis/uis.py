"""Generate and select a private UIS staging bundle. Never reload Asterisk."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


def require(condition):
    if not condition:
        raise ValueError("invalid UIS input or staging state")


def token(value, pattern):
    require(isinstance(value, str) and re.fullmatch(pattern, value))
    return value


def read_secret(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and not info.st_mode & 0o077)
        secret = json.load(stream)
    require(set(secret) == {"username", "password"})
    return (token(secret["username"], r"[a-zA-Z0-9_.+@-]{1,100}"),
            token(secret["password"], r"[a-zA-Z0-9_.+@!%$*~=:?#/-]{1,200}"))


def cidrs(values):
    require(isinstance(values, list) and values)
    networks = [ipaddress.IPv4Network(item) for item in values]
    require(all(net.is_global and net.prefixlen >= 16 for net in networks))
    return sorted(set(map(str, networks)))


def port(value):
    require(type(value) is int and 1 <= value <= 65535)
    return value


def render(profile, secret):
    require(profile["schema"] == 1)
    revision = token(profile["revision"], r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
    bind = ipaddress.IPv4Address(profile["bind_ipv4"])
    require(bind.is_global)
    hostname = r"(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}"
    registrar = token(profile["registrar"], hostname)
    registrar_port = port(profile["registrar_port"])
    transport = token(profile["transport"], r"udp")
    proxy = profile["proxy"]
    require((proxy is None) == (profile["proxy_port"] is None))
    proxy_line = ""
    if proxy is not None:
        proxy = token(proxy, hostname)
        proxy_line = f"outbound_proxy=sip:{proxy}:{port(profile['proxy_port'])}\\;lr\n"
    caller = token(profile["caller_id"], r"\+?[1-9][0-9]{6,14}")
    destination = token(profile["destination"], r"\+?[1-9][0-9]{6,14}")
    codecs = profile["codecs"]
    require(isinstance(codecs, list) and 0 < len(codecs) <= 2
            and all(codec in ("alaw", "ulaw") for codec in codecs))
    signaling = cidrs(profile["signaling_cidrs"])
    rtp = cidrs(profile["rtp_cidrs"])
    username, password = secret
    uri_user = username.replace("@", "%40")
    pjsip = f"""[uis-smoke-transport]
type=transport
protocol={transport}
bind={bind}:5062

[uis-smoke-auth]
type=auth
auth_type=userpass
username={username}
password={password}

[uis-smoke-registration]
type=registration
transport=uis-smoke-transport
outbound_auth=uis-smoke-auth
server_uri=sip:{registrar}:{registrar_port}
client_uri=sip:{uri_user}@{registrar}
{proxy_line}retry_interval=60
max_retries=5
forbidden_retry_interval=0

[uis-smoke-aor]
type=aor
contact=sip:{registrar}:{registrar_port}

[uis-smoke]
type=endpoint
transport=uis-smoke-transport
aors=uis-smoke-aor
outbound_auth=uis-smoke-auth
{proxy_line}context=uis-smoke-deny-ingress
identify_by=ip
direct_media=no
media_address={bind}
bind_rtp_to_media_address=yes
allow_transfer=no
allow_subscribe=no
trust_id_inbound=no
send_pai=yes
from_user={caller}
disallow=all
allow={','.join(codecs)}
"""
    dialplan = f"""[uis-smoke-deny-ingress]

[uis-smoke-dispatch]
exten => approved,1,Set(CALLERID(all)={caller} <{caller}>)
 same => n,Dial(PJSIP/{destination}@uis-smoke,20,iL(30000))
 same => n,Hangup()
"""
    return revision, {
        "pjsip.conf": pjsip,
        "extensions.conf": dialplan,
        "acl.json": json.dumps({"signaling": signaling, "rtp": rtp}) + "\n",
    }


def write_bundle(root, revision, files):
    target = root / revision
    require(not target.exists() and not target.is_symlink())
    temporary = Path(tempfile.mkdtemp(prefix=".uis-", dir=root))
    try:
        for name, content in files.items():
            with (temporary / name).open("x", encoding="utf-8") as stream:
                stream.write(content)
        temporary.rename(target)
    finally:
        if temporary.exists():
            for item in temporary.iterdir():
                item.unlink()
            temporary.rmdir()


def select(root, revision):
    if revision == "off":
        (root / "active").unlink(missing_ok=True)
        return
    token(revision, r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
    target = root / revision
    require(target.is_dir() and not target.is_symlink()
            and all((target / name).is_file() and not (target / name).is_symlink()
                    for name in ("pjsip.conf", "extensions.conf", "acl.json")))
    with tempfile.TemporaryDirectory(prefix=".select-", dir=root) as staging:
        link = Path(staging) / "active"
        link.symlink_to(revision)
        link.replace(root / "active")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    actions = parser.add_subparsers(dest="action", required=True)
    build = actions.add_parser("stage")
    build.add_argument("profile", type=Path)
    build.add_argument("secret", type=Path)
    switch = actions.add_parser("select")
    switch.add_argument("revision")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.root
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and not info.st_mode & 0o077)
    if args.action == "stage":
        revision, files = render(json.loads(args.profile.read_text()), read_secret(args.secret))
        require(revision not in {"active", "off"})
        write_bundle(root, revision, files)
    else:
        select(root, args.revision)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError):
        sys.exit("UIS staging rejected: invalid input, permissions or revision")
