import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('gate',Path(__file__).with_name('review-plan.py'))
g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
class Gate(unittest.TestCase):
 def plan(self): return {'variables':{'folder_id':{'value':g.FOLDERS['staging']},'environment':{'value':'staging'}},'resource_changes':[]}
 def test_clean(self): self.assertEqual(g.check(self.plan(),'staging'),[])
 def test_production(self):
  p=self.plan();p['variables']['folder_id']['value']=g.PRODUCTION;self.assertTrue(g.check(p,'staging'))
 def test_delete(self):
  p=self.plan();p['resource_changes']=[{'type':'yandex_vpc_network','address':'network','change':{'actions':['delete','create']}}];self.assertTrue(g.check(p,'staging'))
 def test_existing_network(self):
  p=self.plan();p['prior_state']={'id':'enph699olhqado0tvo9e'};self.assertTrue(g.check(p,'staging'))
if __name__=='__main__': unittest.main()
