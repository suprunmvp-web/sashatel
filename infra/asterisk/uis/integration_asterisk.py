"""Real Asterisk CI smoke. Run in a disposable network namespace."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler
from base64 import b64encode

from live_worker import Runtime
from test_live_worker import LiveWorkerTest


class IsolatedRuntime(Runtime):
    def __init__(self, root, binary, modules):
        self.root, self.binary, self.process = root, binary, None
        self.cli_config = root / "asterisk.conf"
        self.cli_config.write_text(
            "[directories]\nastetcdir => " + str(root) +
            "\nastmoddir => " + str(modules) +
            "".join(f"\n{key} => {root}" for key in
                    ("astvarlibdir", "astdbdir", "astdatadir", "astspooldir",
                     "astrundir", "astlogdir", "astkeydir")) + "\n")
        bundle = root / "managed/bundles/active"
        (root / "pjsip.conf").write_text(
            "[local]\ntype=transport\nprotocol=udp\nbind=127.0.0.1:5060\n"
            f'#tryinclude "{bundle}/pjsip.conf"\n')
        (root / "extensions.conf").write_text(
            f'#tryinclude "{bundle}/extensions.conf"\n'
            "[ari-ci]\nexten => hold,1,Answer()\n same => n,Wait(45)\n"
            " same => n,Hangup()\n")
        (root / "http.conf").write_text("[general]\nenabled=yes\nbindaddr=127.0.0.1\nbindport=18088\n")
        (root / "ari.conf").write_text("[general]\nenabled=yes\n"
                                       "[ci]\ntype=user\npassword=isolated-ci\nread_only=no\n")

    def cli(self, instruction, check=True):
        return subprocess.run([self.binary, "-C", str(self.cli_config), "-rx", instruction],
                              check=check, text=True, capture_output=True, timeout=5)

    def start(self):
        self.process = subprocess.Popen(
            [self.binary, "-f", "-C", str(self.cli_config)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            result = self.cli("core show uptime", check=False)
            if result.returncode == 0 and "System uptime" in result.stdout:
                return
            if self.process.poll() is not None:
                break
            time.sleep(0.1)
        raise ValueError("isolated Asterisk did not start")

    def drain(self):
        if self.process is None or self.process.poll() is not None:
            return
        if not re.search(r"^0 active channels$", self.cli("core show channels count").stdout, re.M):
            raise ValueError("active channels")
        self.cli("core stop gracefully")
        self.process.wait(timeout=15)

    def cleanup(self):
        if self.process is not None and self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=5)


def ari(path, method="GET"):
    auth = b64encode(b"ci:isolated-ci").decode()
    request = Request("http://127.0.0.1:18088/ari/" + path, method=method,
                      headers={"Authorization": "Basic " + auth})
    with build_opener(ProxyHandler({})).open(request, timeout=5) as response:
        return json.loads(response.read() or "null")


def execute(binary, modules):
    case = LiveWorkerTest()
    case.setUp()
    runtime = IsolatedRuntime(case.root.parent, binary, modules)
    case.addCleanup(runtime.cleanup)
    case.lab = runtime
    case.worker = case.open_worker()
    case.profile.update(bind_ipv4="9.9.9.9", proxy=None, proxy_port=None,
                        registrar="sip.example.net")
    first = case.request()
    try:
        runtime.start()
        case.assertEqual(case.worker.status()["status"], "disabled")
        case.assertIn(case.apply(first), {"applied", "registered"})
        case.assertIn(case.apply(first), {"applied", "registered"})
        runtime.drain()
        runtime.start()
        case.assertEqual(case.open_worker().status()["active_revision"], first["revision"])
        ari("channels?endpoint=Local%2Fhold%40ari-ci%2Fn&context=ari-ci&extension=hold"
            "&priority=1&channelId=ci-leg-one&otherChannelId=ci-leg-two", "POST")
        for _ in range(40):
            if {"ci-leg-one", "ci-leg-two"} <= {row["id"] for row in ari("channels")}:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("both Local legs did not appear")
        try:
            with case.assertRaises(ValueError):
                runtime.drain()
        finally:
            for channel in ("ci-leg-one", "ci-leg-two"):
                try:
                    ari("channels/" + channel, "DELETE")
                except HTTPError as error:
                    if error.code != 404:
                        raise
        for _ in range(40):
            if not ari("channels"):
                break
            time.sleep(0.1)
        else:
            raise AssertionError("ARI teardown left a channel")
        change = case.request(first["revision"])
        real_switch = case.worker.switch

        def failed_switch(revision):
            status = real_switch(revision)
            if revision == change["revision"]:
                raise ValueError("simulated verification failure after loading real candidate")
            return status

        with patch.object(case.worker, "switch", side_effect=failed_switch):
            case.assertEqual(case.apply(change), "rolled_back")
        case.assertEqual(case.open_worker().status()["active_revision"], first["revision"])
        interrupted = case.request(first["revision"])

        def interrupted_switch(revision):
            real_switch(revision)
            raise KeyboardInterrupt

        with patch.object(case.worker, "switch", side_effect=interrupted_switch):
            with case.assertRaises(KeyboardInterrupt):
                case.apply(interrupted)
        case.assertEqual(case.open_worker().status()["active_revision"], first["revision"])
        disable = case.request(first["revision"], enabled=False)
        case.assertEqual(case.worker.apply(disable), "disabled")
        print("PASS: real Asterisk registration object, restart, active-call guard and two-leg ARI teardown")
    finally:
        case.doCleanups()


if __name__ == "__main__":
    execute(sys.argv[1], Path(sys.argv[2]))
