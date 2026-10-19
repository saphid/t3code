import json, os, re, time
from datetime import datetime, timezone

root=os.path.abspath('.')
out='/tmp/t3code-instruction-baseline.json'
started=datetime.now(timezone.utc)
t0=time.perf_counter()
errors=[]; symlink_dirs=[]; symlink_files=[]; symlink_other=[]; instructions=[]; skills=[]
dirs=files=symlinks=visited=0
ire=re.compile(r'^(agents|claude)(?:[._-][a-z0-9_-]+)+[.]md$',re.I)
sre=re.compile(r'^skill(?:[._-][a-z0-9_-]+)+[.]md$',re.I)
def rel(p): return os.path.relpath(p,root)
def err(p,e,op): errors.append({'path':rel(p),'operation':op,'error_type':type(e).__name__,'errno':getattr(e,'errno',None),'message':str(e)})
stack=[root]
while stack:
 d=stack.pop(); visited+=1
 try: ents=list(os.scandir(d))
 except OSError as e: err(d,e,'scandir'); continue
 for e in ents:
  p=e.path; name=e.name
  try: link=e.is_symlink()
  except OSError as x: err(p,x,'is_symlink'); link=False
  if link:
   symlinks+=1
   try: target=os.readlink(p)
   except OSError as x: target=None; err(p,x,'readlink')
   try: exists=os.path.exists(p); td=os.path.isdir(p); tf=os.path.isfile(p)
   except OSError as x: exists=td=tf=None; err(p,x,'stat_symlink_target')
   rec={'path':rel(p),'target':target,'target_exists':exists}
   if td: rec['target_is_dir']=True; symlink_dirs.append(rec)
   elif tf: rec['target_is_file']=True; symlink_files.append(rec)
   else: rec['target_is_other']=True; symlink_other.append(rec)
   continue
  try: isdir=e.is_dir(follow_symlinks=False)
  except OSError as x: err(p,x,'is_dir'); continue
  if isdir:
   dirs+=1; stack.append(p); continue
  try: isfile=e.is_file(follow_symlinks=False)
  except OSError as x: err(p,x,'is_file'); isfile=False
  if not isfile: continue
  files+=1
  low=name.lower()
  if low=='agents.md': instructions.append({'path':rel(p),'basename':name,'classification':'exact','family':'AGENTS.md','is_symlink':False,'target':None})
  elif low=='claude.md': instructions.append({'path':rel(p),'basename':name,'classification':'exact','family':'CLAUDE.md','is_symlink':False,'target':None})
  elif ire.fullmatch(name): instructions.append({'path':rel(p),'basename':name,'classification':'plausible_variant','family':name.split('.')[0].upper(),'is_symlink':False,'target':None})
  if low=='skill.md': skills.append({'path':rel(p),'basename':name,'classification':'exact','family':'SKILL.md','is_symlink':False,'target':None})
  elif sre.fullmatch(name): skills.append({'path':rel(p),'basename':name,'classification':'plausible_variant','family':'SKILL.md','is_symlink':False,'target':None})
for seq in (errors,symlink_dirs,symlink_files,symlink_other,instructions,skills): seq.sort(key=lambda x:x['path'].casefold())
finished=datetime.now(timezone.utc); elapsed=time.perf_counter()-t0
counts={'directories_encountered':dirs,'directory_paths_visited':visited,'regular_files_encountered':files,'symlink_entries':symlinks,'symlink_directories':len(symlink_dirs),'symlink_files':len(symlink_files),'symlink_other_or_broken':len(symlink_other),'walk_errors':len(errors),'instruction_candidates':len(instructions),'instruction_exact_candidates':sum(x['classification']=='exact' for x in instructions),'instruction_plausible_variant_candidates':sum(x['classification']=='plausible_variant' for x in instructions),'skill_candidates':len(skills),'skill_exact_candidates':sum(x['classification']=='exact' for x in skills),'skill_plausible_variant_candidates':sum(x['classification']=='plausible_variant' for x in skills)}
report={'schema_version':2,'root':root,'traversal':{'method':'Python os.scandir iterative traversal','followlinks':False,'hidden_and_ignored_directories_included':True,'entry_or_depth_limit':None,'candidate_matching':{'instruction_exact':['AGENTS.md','CLAUDE.md'],'instruction_case_sensitive':False,'instruction_plausible_variant_regex':r'^(agents|claude)(?:[._-][a-z0-9_-]+)+[.]md$','skill_exact':['SKILL.md'],'skill_case_sensitive':False,'skill_plausible_variant_regex':r'^skill(?:[._-][a-z0-9_-]+)+[.]md$'},'started_at_utc':started.isoformat(),'finished_at_utc':finished.isoformat(),'elapsed_seconds':elapsed},'counts':counts,'instruction_candidates':instructions,'skill_candidates':skills,'symlink_directories':symlink_dirs,'symlink_files':symlink_files,'symlink_other_or_broken':symlink_other,'walk_errors':errors}
os.makedirs(os.path.dirname('/Users/aus-m5p-as/projects/t3code-contrib/tmp/instruction-discovery/instruction-baseline.json'),exist_ok=True)
with open(out,'w',encoding='utf-8') as f: json.dump(report,f,indent=2); f.write('\n')
os.replace(out,'/Users/aus-m5p-as/projects/t3code-contrib/tmp/instruction-discovery/instruction-baseline.json')
print(json.dumps({'counts':counts,'elapsed_seconds':elapsed,'report':'tmp/instruction-discovery/instruction-baseline.json'},indent=2))
