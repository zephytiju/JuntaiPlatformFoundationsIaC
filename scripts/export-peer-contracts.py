"""Export public logical contracts from normally installed selected peer wheels."""
import argparse,json,subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--metadata-python',type=Path,required=True)
parser.add_argument('--blueprint-python',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
values={}
for label,repo,module,cls,package in [
 ('application-metadata','JuntaiApplicationMetadata-review','juntai_application_metadata.persistence.meridian.schema','ApplicationMetadataSchemaProvider','juntai-application-metadata'),
 ('blueprint','JuntaiBlueprintMarketplace','juntai_blueprint_marketplace.persistence.meridian.schemas','BlueprintSchemaProvider','juntai-blueprint-marketplace')]:
 code=f'''import json,importlib.metadata as m
from {module} import {cls}
from meridian_storage.plugins.config_artifact.schemas import ConfigArtifactSchemaProvider
from meridian_storage.semantics import StructuredCatalogProvider
from meridian_storage.object_common import ObjectCatalogProvider
from packaging.requirements import Requirement
def package_closure(root):
 result={{}}; queue=[(root,frozenset())]; seen=set()
 while queue:
  name,extras=queue.pop()
  if (name,extras) in seen: continue
  seen.add((name,extras))
  if name.startswith(('meridian-storage-','meridian-plugin-')): result[name]=m.version(name)
  for raw in m.requires(name) or []:
   req=Requirement(raw)
   if req.marker is None or any(req.marker.evaluate({{'extra':extra}}) for extra in (set(extras)|{{''}})):
    queue.append((req.name,frozenset(req.extras)))
 return result
providers=[({cls}(),{package!r}),(ConfigArtifactSchemaProvider(),'meridian-plugin-config-artifact')]
def export_provider(provider,package):
 b=provider.load()
 return {{'pin':{{'id':b.provider_id,'package':package,'version':b.provider_version,'contract':b.provider_contract_version,'requiredFingerprint':b.fingerprint}},'resources':[{{'definition':r.to_dict(),'fingerprint':r.fingerprint,'schemaFingerprint':next((s.fingerprint for s in b.schemas if s.ref==r.schema),None)}} for r in b.resources]}}
catalogs=[StructuredCatalogProvider(),ObjectCatalogProvider()]
if {label!r}=='blueprint':
 from meridian_storage.evidence import EvidenceCatalogProvider
 catalogs.append(EvidenceCatalogProvider())
print(json.dumps({{'package':{package!r},'version':m.version({package!r}),'packages':package_closure({package!r}),'providers':[export_provider(p,n) for p,n in providers],'catalogs':[{{'name':x.manifest().catalog_name,'package':x.manifest().package_name,'contract':x.manifest().catalog_contract_version,'requiredFingerprint':x.manifest().fingerprint}} for x in catalogs]}}))
'''
 values[label]=json.loads(subprocess.check_output([str(args.metadata_python if label=='application-metadata' else args.blueprint_python),'-c',code],text=True))
assert {k:v['version'] for k,v in values.items()} == {'application-metadata':'3.2.1','blueprint':'3.3.1'}, 'installed peer release differs'
p=args.output
p.write_text(json.dumps({'formatVersion':'juntai.platform.peer-meridian-contracts.v1','peers':values},indent=2,sort_keys=True)+'\n')
print(json.dumps({k:{'version':v['version'],'providers':[p['pin'] for p in v['providers']]} for k,v in values.items()}))
