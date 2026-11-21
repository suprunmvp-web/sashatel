#!/usr/bin/env python3
"""One-off, fail-closed SashaTel YC staging Backend rollout.

Keeps the existing Cloudflare -> 127.0.0.1:8083 route unchanged. Runs only
after the reviewed staging OCI image is published. Preserves all old env-file
paths, mounts, network, user and restart policy; maintains stopped rollback.
No DB migrations, new resources, PSTN, secrets output or host port exposure.
"""
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request

REGISTRY = "cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend"
IMAGE_TAG = REGISTRY + ":f25b075087eb233cbca8f7ed192eb61ca17c0ee8"
CURRENT = "sashatel-staging-api-session-fix"
PORT = 8083
API_ORIGIN = "https://platform.sashatel.ru"

def run(args, *, env=None, input=None):
    return subprocess.run(args,check=True,text=True,input=input,env=env,
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.strip()

def docker(*args):
    return run(["docker", *args])

def check_ready(port=PORT):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/ready" % port,timeout=3) as response:
            return response.status==200 and json.loads(response.read()).get("status")=="ready"
    except Exception:
        return False

def fail(message):
    raise RuntimeError(message)

if os.geteuid()!=0:
    fail("Запустите скрипт через sudo")
if not check_ready():
    fail("Текущий Backend на 8083 не готов; ничего не изменено")

original=json.loads(docker("inspect",CURRENT))[0]
conf=original["Config"]
host=original["HostConfig"]
envs=dict(item.split("=",1) for item in conf["Env"] if "=" in item)
if envs.get("WEB_ORIGIN")!=API_ORIGIN or envs.get("LIVE_CALL_DISPATCH")!="disabled":
    fail("WEB_ORIGIN / LIVE_CALL_DISPATCH не совпадают; ничего не изменено")
if not envs.get("DADATA_API_KEY_FILE"):
    fail("DaData API key file not configured")
for key in envs:
    if re.search(r"(?:TOKEN|PASSWORD|SECRET|API_KEY)$",key) and not key.endswith("_FILE"):
        fail("Sensitive environment value must be file-backed")
if conf.get("Entrypoint") not in (None,[],[""]):
    fail("Unexpected existing entrypoint; refusing to override")
if conf.get("Cmd")!=["node","server.ts"]:
    fail("Unexpected existing container command")
networks=list(original["NetworkSettings"]["Networks"])
if len(networks)!=1:
    fail("Expected exactly one private Docker network")
network=networks[0]
binding=host["PortBindings"].get("8080/tcp")
if not binding or len(binding)!=1 or binding[0].get("HostIp")!="127.0.0.1" or binding[0].get("HostPort")!=str(PORT):
    fail("Unexpected port binding; refusing public exposure")
mounts=original["Mounts"]
if not mounts:
    fail("No secret-file mounts found")
keyfile=envs["DADATA_API_KEY_FILE"]
if not any(m["Destination"]==keyfile and not m["RW"] for m in mounts):
    fail("DaData secret is not mounted read-only")

with tempfile.TemporaryDirectory(prefix="sashatel-docker-auth-") as authdir:
    os.chmod(authdir,0o700)
    request=urllib.request.Request(
        "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor":"Google"})
    with urllib.request.urlopen(request,timeout=7) as response:
        token=json.load(response)["access_token"]
    isolated_env={**os.environ,"DOCKER_CONFIG":authdir}
    run(["docker","login","--username","iam","--password-stdin","cr.yandex"],
        env=isolated_env,input=token+"\n")
    token=""
    print("Проверяю immutable Backend image из Yandex Container Registry…",flush=True)
    run(["docker","pull",IMAGE_TAG],env=isolated_env)
    digests=json.loads(docker("image","inspect",IMAGE_TAG,"--format","{{json .RepoDigests}}"))
    candidates=[value for value in digests if re.fullmatch(re.escape(REGISTRY)+r"@sha256:[0-9a-f]{64}",value)]
    if not candidates:
        fail("Не удалось получить закреплённый digest образа")
    image=candidates[0]

# A one-shot DaData probe does not start the Web API or mail outbox.
mount=next(m for m in mounts if m["Destination"]==keyfile)
if mount["Type"]!="bind":
    fail("Expected a read-only bind mount for DaData key")
probe_mount="type=bind,source=%s,target=%s,readonly"%(mount["Source"],mount["Destination"])
code=(
 'import {readFile} from "node:fs/promises";'
 'import {DaDataLookup} from "./web-ports.ts";'
 'const k=(await readFile(process.env.DADATA_API_KEY_FILE,"utf8")).trim();'
 'const a=await new DaDataLookup(k).suggest("7707");'
 'if(!Array.isArray(a)||!a.some(x=>x.inn.startsWith("7707")))process.exit(1);'
 'console.log("DaData suggest: "+a.length+" результатов");'
)
print("Проверяю живую DaData с четырьмя цифрами, без вывода ключа…",flush=True)
print(run(["docker","run","--rm","--network",network,
           "--user",conf.get("User") or "1000:1000",
           "--mount",probe_mount,
           "--env","DADATA_API_KEY_FILE="+keyfile,
           "--entrypoint","node",image,
           "--input-type=module","-e",code]))

args=["docker","run","-d","--name",CURRENT,
      "--network",network,
      "--publish","127.0.0.1:%d:8080"%PORT]
if conf.get("User"):
    args+=["--user",conf["User"]]
if host.get("ReadonlyRootfs"):
    args+=["--read-only"]
for item in host.get("SecurityOpt") or []:
    args+=["--security-opt",item]
for cap in host.get("CapDrop") or []:
    args+=["--cap-drop",cap]
for cap in host.get("CapAdd") or []:
    args+=["--cap-add",cap]
policy=(host.get("RestartPolicy") or {}).get("Name") or "no"
args+=["--restart",policy]
for item in conf["Env"]:
    args+=["--env",item]
for m in mounts:
    if m["Type"] not in ("bind","volume"):
        fail("Unexpected mount type")
    spec="type=%s,source=%s,target=%s"%(m["Type"],m["Source"] if m["Type"]=="bind" else m["Name"],m["Destination"])
    if not m["RW"]:
        spec+=",readonly"
    args+=["--mount",spec]
args.append(image)

backup=CURRENT+"-rollback-"+time.strftime("%Y%m%d-%H%M%S",time.gmtime())
print("Проверки пройдены; меняю только контейнер на порту 8083…",flush=True)
renamed=False
try:
    docker("stop",CURRENT)
    docker("rename",CURRENT,backup)
    renamed=True
    run(args)
    for _ in range(30):
        if check_ready():
            print("SUCCESS: Backend на 8083 готов. Cloudflare route не менялся.")
            print("Новая версия:",image)
            print("Rollback container:",backup)
            break
        time.sleep(2)
    else:
        fail("Новый Backend не прошёл /ready")
except Exception:
    print("Ошибка запуска; выполняю откат приложения…",flush=True)
    subprocess.run(["docker","rm","-f",CURRENT],capture_output=True)
    if renamed:
        docker("rename",backup,CURRENT)
    docker("start",CURRENT)
    if not check_ready():
        print("ВНИМАНИЕ: восстановленный контейнер не отвечает /ready")
    raise
