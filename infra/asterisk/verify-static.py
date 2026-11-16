"""Run offline checks for stage A using Python 3 and Bash."""
from pathlib import Path
import re
import runpy
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent


def verify():
    subprocess.run(["bash", "-n", str(ROOT / "build.sh")], check=True)
    with TemporaryDirectory() as work:
        path = Path(work) / "config"
        command = [
            sys.executable, str(ROOT / "render.py"), str(path),
            "--bind", "10.50.0.1", "--peer-1001", "10.50.0.2",
            "--peer-1002", "10.50.0.3",
        ]
        for invalid in ["8.8.8.8", "10.50.0.2"]:
            result = subprocess.run(command[:-1] + [invalid], capture_output=True)
            assert result.returncode and not path.exists()
        subprocess.run(command, check=True)
        assert subprocess.run(command, capture_output=True).returncode
        assert stat.S_IMODE(path.stat().st_mode) == 0o700
        assert all(stat.S_IMODE(item.stat().st_mode) == 0o600 for item in path.iterdir())
        config = (path / "pjsip.conf").read_text()
        assert len(set(re.findall(r"^password=([a-f0-9]{64})$", config, re.M))) == 2
        assert not re.search(r"@[A-Z0-9_]+@", config)
        routes = re.findall(r"^exten => (\d+),1,Dial\(PJSIP/(\d+),25,i\)$",
                            (path / "extensions.conf").read_text(), re.M)
        assert routes == [("1002", "1002"), ("1001", "1001")]
        for service in ("http", "ari", "manager"):
            assert "enabled=no" in (path / (service + ".conf")).read_text()
        assert "EventTime,EventType,ChanName,UniqueID,LinkedID,EventExtra" in (
            path / "cel_custom.conf").read_text()

    check = runpy.run_path(str(ROOT / "check-vpn.py"))["check"]
    state = {
        "flags": ["UP"], "kind": "wireguard", "address": "10.50.0.1",
        "route": "wg0",
    }

    def test_ip(*args):
        if "link" in args:
            return [{"flags": state["flags"], "linkinfo": {"info_kind": state["kind"]}}]
        if "addr" in args:
            return [{"addr_info": [{"local": state["address"]}]}]
        assert args[4:6] == ("from", "10.50.0.1")
        return [{"dev": state["route"]}]

    check.__globals__["ip_json"] = test_ip
    check(config)
    for key, invalid in [("flags", []), ("kind", "dummy"),
                         ("address", "10.50.0.8"), ("route", "eth0")]:
        valid = state[key]
        state[key] = invalid
        try:
            check(config)
        except ValueError:
            pass
        else:
            raise AssertionError(f"VPN guard allowed invalid {key}")
        state[key] = valid
    print("PASS: build syntax, render, modes, secrets, routing, management, CEL, VPN guard")


if __name__ == "__main__":
    verify()
