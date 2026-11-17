#!/usr/bin/env python3
"""Fail closed before deploying a component release. Never consumes credentials."""
import json
import re
import sys

def errors(m):
 e=[]
 if m.get('origin') != 'https://staging.platform.sashatel.ru': e.append('Unexpected origin')
 if m.get('infrastructure',{}).get('folder_id') != 'b1gi9a6fgkr55k6csn9s': e.append('Not staging folder')
 if m.get('telephony_enabled') is not False: e.append('Telephony must remain disabled')
 if m.get('email_mode') != 'test_sink' or m.get('sink_access') != 'testers_only': e.append('Unapproved email mode/access')
 if m.get('web',{}).get('api_mode') != 'real': e.append('Mock Web API is prohibited')
 for component in ('backend','web'):
  c=m.get(component,{})
  if not re.fullmatch('[0-9a-f]{40}',c.get('release_sha') or ''): e.append(component+': release SHA missing')
 b=m.get('backend',{});w=m.get('web',{})
 if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}',b.get('image') or ''): e.append('Backend immutable OCI digest missing')
 for c,k in ((b,'start_argv'),(b,'migration_argv'),(w,'build_argv')):
  argv=c.get(k)
  if not isinstance(argv,list) or not argv or not all(isinstance(s,str) and s for s in argv): e.append(k+' must be explicit argv')
 if not b.get('schema_version'): e.append('Schema version missing')
 if not (b.get('readiness_path') or '').startswith('/'): e.append('Readiness path missing')
 if not re.fullmatch('[0-9a-f]{64}',w.get('artifact_sha256') or ''): e.append('Web artifact checksum missing')
 if m.get('blockers'): e.append('Unresolved release blockers')
 return e
if __name__=='__main__':
 with open(sys.argv[1]) as f: m=json.load(f)
 result=errors(m)
 for item in result: print(item)
 sys.exit(bool(result))
