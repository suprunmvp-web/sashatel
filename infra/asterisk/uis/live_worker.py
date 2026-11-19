"""Apply a single scoped UIS bundle. Run only from the trusted Backend worker."""
import argparse
from contextlib import contextmanager
import fcntl
import grp
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid

from uis import read_secret, render, require


CONFIG = "/etc/sashatel-asterisk/asterisk.conf"
BINARY = "/opt/sashatel-asterisk/22.12.0/sbin/asterisk"
UNIT = "sashatel-asterisk.service"


def command(*args, check=True):
    return subprocess.run(args, capture_output=True, text=True, timeout=20, check=check)


class Runtime:
    def cli(self, instruction, check=True):
        return command(BINARY, "-n", "-C", CONFIG, "-rx", instruction, check=check)

    def active(self):
        return command("/usr/bin/systemctl", "is-active", "--quiet", UNIT,
                       check=False).returncode == 0

    def drain(self):
        if not self.active():
            return
        channels = self.cli("core show channels count").stdout
        require(re.search(r"^[ \t]*0 active channels?[ \t\r]*$", channels, re.M))
        try:
            self.cli("core stop gracefully")
        except subprocess.TimeoutExpired:
            # The CLI can lose its reply as Asterisk shuts down. Verify exit below.
            pass
        for _ in range(60):
            if command("/usr/bin/systemctl", "show", "-p", "ActiveState", "--value",
                       UNIT).stdout.strip() in {"inactive", "failed"}:
                return
            time.sleep(1)
        raise ValueError("Asterisk did not stop cleanly")

    def start(self):
        command("/usr/bin/systemctl", "start", UNIT)

    def inspect(self, enabled):
        self.cli("core show uptime")
        output = self.cli("pjsip show registrations").stdout
        registration = re.search(
            r"^\s*uis-smoke-registration/\S+\s+uis-smoke-auth\s+"
            r"(Registered|Unregistered|Rejected|Stopped)\b", output, re.M)
        present = re.search(r"^\s*uis-smoke-registration/", output, re.M)
        dialplan = self.cli("dialplan show uis-smoke-dispatch").stdout
        context = re.search(r"^\[ Context 'uis-smoke-dispatch'", dialplan, re.M)
        if not enabled:
            require(not present and not context)
            return "disabled"
        require(registration and context)
        transport = self.cli("pjsip show transport uis-smoke-transport").stdout
        require(re.search(r"^\s*Transport:\s+uis-smoke-transport\s+udp\b", transport, re.M))
        return "registered" if registration[1] == "Registered" else "applied"


def atomic_json(path, payload):
    fd, name = tempfile.mkstemp(dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Worker:
    def __init__(self, state, runtime, tenant, trunk, group):
        self.state, self.runtime, self.group = state, runtime, group
        self.scope = {"tenant_id": tenant, "trunk_id": trunk}
        self.manifest = state / "manifest.json"
        self.root = state / "bundles"
        state.mkdir(mode=0o750, exist_ok=True)
        self.root.mkdir(mode=0o750, exist_ok=True)
        for directory in (state, self.root):
            info = directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and not info.st_mode & 0o027)
            os.chown(directory, -1, group)
            directory.chmod(0o750)
        self.active = self.root / "active"

    @contextmanager
    def lock(self):
        fd = os.open(self.state / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def read(self):
        if self.manifest.exists():
            result = json.loads(self.manifest.read_text())
            require(result["scope"] == self.scope)
            return result
        require(not self.active.is_symlink() and not self.active.exists())
        return {"scope": self.scope, "current": None, "generation": None, "pending": None, "requests": {}}

    def publish(self, revision):
        if revision is None:
            self.active.unlink(missing_ok=True)
        else:
            target = self.root / revision
            require(target.is_dir() and not target.is_symlink())
            with tempfile.TemporaryDirectory(dir=self.root) as work:
                link = Path(work) / "active"
                link.symlink_to(revision)
                link.replace(self.active)
        sync(self.root)

    def stage(self, revision, files):
        target = self.root / revision
        require(not target.exists() and not target.is_symlink())
        with tempfile.TemporaryDirectory(dir=self.root) as work:
            bundle = Path(work) / "files"
            bundle.mkdir(mode=0o750)
            os.chown(bundle, -1, self.group)
            bundle.chmod(0o750)
            for basename, content in files.items():
                path = bundle / basename
                with path.open("x", encoding="utf-8") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chown(path, -1, self.group)
                path.chmod(0o640)
            sync(bundle)
            bundle.rename(target)
            sync(self.root)

    def switch(self, revision):
        self.runtime.drain()
        self.publish(revision)
        self.runtime.start()
        for attempt in range(20):
            try:
                return self.runtime.inspect(revision is not None)
            except (ValueError, subprocess.SubprocessError):
                if attempt == 19:
                    raise
                time.sleep(1)

    def recover(self, state):
        if state["pending"] is not None:
            status = self.switch(state["current"])
            request = state["pending"]
            state["requests"][request["request_id"]] = {
                "request": request, "status": "rolled_back",
            }
            state["pending"] = None
            atomic_json(self.manifest, state)
            return status
        enabled = state["current"] is not None
        require((self.active.is_symlink() and os.readlink(self.active) == state["current"])
                if enabled else not os.path.lexists(self.active))
        return self.runtime.inspect(enabled)

    def apply(self, request, profile=None, secret=None):
        require(all(request[key] == value for key, value in self.scope.items()))
        require(set(request) == set(self.scope) | {
            "request_id", "expected_revision", "revision", "enabled",
        })
        for field in ("request_id", "revision"):
            require(str(uuid.UUID(request[field])) == request[field])
        require(type(request["enabled"]) is bool)
        with self.lock():
            state = self.read()
            require(state["pending"] is None)
            previous = state["requests"].get(request["request_id"])
            if previous is not None:
                require(previous["request"] == request)
                return previous["status"]
            require(request["expected_revision"] == state["generation"]
                    and request["revision"] != state["generation"]
                    and not any(record["request"]["revision"] == request["revision"]
                                for record in state["requests"].values()))
            revision = request["revision"] if request["enabled"] else None
            if revision:
                rendered, files = render(profile, secret)
                require(rendered == revision)
                self.stage(revision, files)
            state["pending"] = request
            atomic_json(self.manifest, state)
            try:
                status = self.switch(revision)
            except (OSError, ValueError, subprocess.SubprocessError):
                self.recover(state)
                return "rolled_back"
            state["current"] = revision
            state["generation"] = request["revision"]
            state["pending"] = None
            state["requests"][request["request_id"]] = {"request": request, "status": status}
            atomic_json(self.manifest, state)
            return status

    def status(self):
        with self.lock():
            state = self.read()
            status = self.recover(state)
            return {"revision": state["generation"], "active_revision": state["current"],
                    "status": status}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--trunk", required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("status")
    apply = actions.add_parser("apply")
    apply.add_argument("request", type=Path)
    apply.add_argument("--profile", type=Path)
    apply.add_argument("--secret", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    tenant, trunk = (str(uuid.UUID(value)) for value in (args.tenant, args.trunk))
    require(args.state == Path("/etc/sashatel-asterisk/uis-managed"))
    worker = Worker(args.state, Runtime(), tenant, trunk, grp.getgrnam("sashatel-pbx").gr_gid)
    if args.action == "status":
        print(json.dumps(worker.status()))
        return
    request = json.loads(args.request.read_text())
    require(args.profile is not None and args.secret is not None if request["enabled"]
            else args.profile is None and args.secret is None)
    status = worker.apply(request, json.loads(args.profile.read_text()) if args.profile else None,
                          read_secret(args.secret) if args.secret else None)
    print(json.dumps({"request_id": request["request_id"], "status": status}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        sys.exit("UIS apply failed; keep dispatch closed and reconcile")
