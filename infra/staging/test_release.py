import importlib.util,json,unittest
from pathlib import Path
p=Path(__file__).parent
s=importlib.util.spec_from_file_location('release',p/'check-release.py');g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
class Release(unittest.TestCase):
 def ready(self):
  m=json.loads((p/'release-manifest.json').read_text());m['blockers']=[]
  for c in ('backend','web'):m[c]['release_sha']='1'*40
  m['backend'].update(image='example.invalid/repo@sha256:'+'2'*64,start_argv=['node','server.ts'],migration_argv=['node','migrate.ts'],schema_version='fixture-only',readiness_path='/health')
  m['web'].update(artifact_sha256='3'*64,build_argv=['npm','run','build']);return m
 def test_undelivered_release_blocked(self):self.assertTrue(g.errors(json.loads((p/'release-manifest.json').read_text())))
 def test_complete_fixture_passes(self):self.assertFalse(g.errors(self.ready()))
 def test_no_mock(self):
  m=self.ready();m['web']['api_mode']='mock';self.assertTrue(g.errors(m))
 def test_no_live_calls(self):
  m=self.ready();m['telephony_enabled']=True;self.assertTrue(g.errors(m))
 def test_no_mutable_image(self):
  m=self.ready();m['backend']['image']='example.invalid/repo:latest';self.assertTrue(g.errors(m))
 def test_no_production_folder(self):
  m=self.ready();m['infrastructure']['folder_id']='b1gou85cm06pvufkk3oe';self.assertTrue(g.errors(m))
if __name__=='__main__':unittest.main()
