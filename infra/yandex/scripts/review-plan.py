#!/usr/bin/env python3
"""Offline safety gate for a PRIVATE terraform show -json file. Never prints values."""
import json
import sys
PRODUCTION = 'b1gou85cm06pvufkk3oe'
PROTECTED = {PRODUCTION, 'enph699olhqado0tvo9e', 'enptvhvs1m5djr45ce55',
 'ajckqb3mn59cva3cpqba', 'b1l7f13r50iu4a0atv1j', 'e2l8880pfgeuno3h8f3r',
 'e9b52mpdtv3pk5rk2lvm', 'fl8ui3pkfu011btmpt0g',
 'enpthm9vaqno3a8ogprk', 'enpvu58hp9c0qk5ktjmn'}
FOLDERS = {'bootstrap': 'b1gga2v07q1av7123dp0', 'staging': 'b1gi9a6fgkr55k6csn9s'}
def strings(value):
 if isinstance(value, str): yield value
 elif isinstance(value, dict):
  for v in value.values(): yield from strings(v)
 elif isinstance(value, list):
  for v in value: yield from strings(v)
def check(plan, phase):
 errors=[]
 if any(any(p in value for p in PROTECTED) for value in strings(plan)):
  errors.append('Protected existing resource or production reference')
 if plan.get('variables', {}).get('folder_id', {}).get('value') != FOLDERS[phase]:
  errors.append('Wrong or missing target folder')
 if phase == 'staging' and plan.get('variables', {}).get('environment', {}).get('value') != 'staging':
  errors.append('Not staging environment')
 for r in plan.get('resource_changes', []):
  if r.get('mode') == 'data': continue
  actions=r['change']['actions']
  if actions not in (['create'], ['no-op']): errors.append('Non-create managed change: '+r['address'])
  if phase == 'bootstrap' and r['type'] not in {'yandex_storage_bucket','yandex_kms_symmetric_key','yandex_ydb_database_serverless'}:
   errors.append('Unexpected bootstrap type: '+r['type'])
 return errors
if __name__ == '__main__':
 if len(sys.argv)!=3 or sys.argv[1] not in FOLDERS:
  sys.exit('Usage: review-plan.py bootstrap|staging PRIVATE_PLAN_JSON')
 with open(sys.argv[2]) as f: errors=check(json.load(f),sys.argv[1])
 for error in errors: print(error)
 if errors: sys.exit(1)
 print('Create-only scope gate passed; IAM, quote, capacity and secrets still require review.')
