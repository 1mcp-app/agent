#!/usr/bin/env python3
"""Native #651 diagnostics. Writes only newly created /private/tmp/1mcp-651 fixtures.

Usage: python3 -B scripts/verify-native-preparation-graphs.py CODEGRAPH_BUNDLE CRG_PYTHON
No backend installation, daemon launch, lock repair, or production readiness claim.
"""
import hashlib
import json
import os
import platform
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BASE = Path('/private/tmp/1mcp-651')
CG = Path(sys.argv[1]).resolve(strict=True)
# Preserve the virtualenv launcher path: resolving its symlink loses site-packages.
CRG = Path(sys.argv[2]).absolute()
if not CRG.is_file():
    raise ValueError("Installed CRG interpreter is missing")
NODE = CG / 'node'
CLI = CG / 'lib/dist/bin/codegraph.js'
LIB = CG / 'lib/dist'
ENV = dict(os.environ, CODEGRAPH_NO_DAEMON='1', CODEGRAPH_NO_DOWNLOAD='1',
           CODEGRAPH_TELEMETRY='0', CODEGRAPH_NO_FAST_INIT='1',
           PYTHONDONTWRITEBYTECODE='1')
CG_READ = '''const sdk=require(process.argv[1]+'/index.js');
(async()=>{const g=await sdk.default.open(process.argv[2],{readOnly:true});
try{console.log(JSON.stringify({state:g.getIndexState(),extractionStale:g.isIndexStale(),
changes:process.argv[4]==='scan'?g.getChangedFiles():null,
results:g.searchNodes(process.argv[3],{limit:10})}));}finally{g.destroy();}})()
.catch(e=>{console.error(e);process.exitCode=1;});'''
CG_LOCK = '''const {FileLock}=require(process.argv[1]+'/utils.js');
const l=new FileLock(process.argv[2]+'/.codegraph/codegraph.lock');l.acquire();
console.log('native-lock-acquired');
function end(){l.release();process.exit(0);}process.on('SIGTERM',end);process.on('SIGINT',end);
setInterval(()=>{},1000);'''


def run(argv, cwd, timeout=45):
    start = time.monotonic()
    result = subprocess.run([str(a) for a in argv], cwd=cwd, env=ENV,
                            capture_output=True, text=True, timeout=timeout)
    return dict(command=[str(a) for a in argv], exit=result.returncode,
                elapsedMs=round((time.monotonic()-start)*1000, 2),
                stdout=result.stdout[-20000:], stderr=result.stderr[-20000:])


def checked(argv, cwd):
    result = run(argv, cwd)
    if result['exit'] != 0:
        raise RuntimeError(json.dumps(result))
    return result


def git(root, *args):
    return checked(['git', '-c', 'core.hooksPath=/dev/null', '-C', root, *args], root.parent)


def commit(root):
    git(root, 'add', 'fixture.py')
    git(root, '-c', 'user.name=Native acceptance', '-c', 'user.email=acceptance@example.invalid',
        'commit', '-qm', 'Native fixture')


def snapshot(root):
    return {str(f.relative_to(root)): hashlib.sha256(f.read_bytes()).hexdigest()
            for name in ['.codegraph', '.code-review-graph']
            for f in (root/name).rglob('*') if f.is_file()}


def readcg(root, symbol, scan=False):
    return checked([NODE, '-e', CG_READ, LIB, root, symbol, 'scan' if scan else 'no-scan'], root)


def crg(root, *args):
    return run([CRG, '-B', '-m', 'code_review_graph', *args, '--repo', root], root)


CG_BULK_LOCK = """const sdk=require(process.argv[1]+'/index.js');
const l=new sdk.FileLock(process.argv[2]+'/.codegraph/codegraph.lock');l.acquire();
const d=sdk.DatabaseConnection.open(sdk.getDatabasePath(process.argv[2]));d.beginBulkNodeLoad();
console.log('native-lock-acquired');
function end(){d.endBulkNodeLoad();d.close();l.release();process.exit(0);}
process.on('SIGTERM',end);process.on('SIGINT',end);setInterval(()=>{},1000);"""
CG_TRIGGERS = """const sdk=require(process.argv[1]+'/index.js');
const d=sdk.DatabaseConnection.open(sdk.getDatabasePath(process.argv[2]),{readOnly:true});
try{console.log(JSON.stringify(d.getDb().prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='nodes_ai'").all()));}finally{d.close();}"""


def foreign_lock(root, bulk=False):
    (root/'.codegraph').mkdir(exist_ok=True)
    proc = subprocess.Popen([str(NODE), '-e', CG_BULK_LOCK if bulk else CG_LOCK, str(LIB), str(root)],
                            cwd=root, env=ENV, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, start_new_session=True)
    # Native lock holder emits only after FileLock.acquire succeeds.
    import select
    if not select.select([proc.stdout], [], [], 5)[0]:
        proc.terminate()
        proc.wait(timeout=5)
        raise RuntimeError('Native lock holder did not become ready')
    if proc.stdout.readline().strip() != 'native-lock-acquired':
        raise RuntimeError('Native lock acquisition failed')
    return proc


def release(proc):
    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=5)
    if proc.returncode != 0:
        raise RuntimeError('Native holder did not release its own lock')


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    bundle_meta = json.loads((CG/'package.json').read_text())
    version = checked([CRG, '-B', '-c',
        'import code_review_graph; print(code_review_graph.__version__); print(code_review_graph.__file__)'], BASE)
    report = dict(platform=platform.platform(), codegraph=bundle_meta,
                  codeReviewGraph=version, supported=False, fixtures=[])
    crg_source = Path(version['stdout'].splitlines()[-1]).parent
    source_specs = [
        (LIB/'index.js', [(282, 300), (446, 453), (762, 769), (1270, 1275)]),
        (LIB/'utils.js', [(269, 317), (321, 335)]),
        (LIB/'db/index.js', [(187, 218)]),
        (LIB/'bin/codegraph.js', [(633, 705), (927, 945)]),
        (crg_source/'graph.py', [(701, 722), (978, 1013), (1102, 1110), (1143, 1148)]),
        (crg_source/'incremental.py', [(1744, 1781), (1833, 1846), (2136, 2146)]),
    ]
    report['sourceEvidence'] = []
    for source, spans in source_specs:
        content = source.read_bytes()
        lines = content.decode().splitlines()
        report['sourceEvidence'].append(dict(path=str(source), sha256=hashlib.sha256(content).hexdigest(),
            excerpts=[dict(firstLine=a, lastLine=b, text='\n'.join(lines[a-1:b])) for a,b in spans]))
    directory = Path(tempfile.mkdtemp(prefix='graphs-native-', dir=BASE))
    report['fixtureDirectory'] = str(directory)
    roots = {name: directory/name for name in ['main', 'linked', 'independent']}
    roots['main'].mkdir()
    git(roots['main'], 'init', '-q')
    (roots['main']/'fixture.py').write_text('def mainUnique651():\n    return "main"\n')
    commit(roots['main'])
    git(roots['main'], 'worktree', 'add', '-qb', 'linked-651', str(roots['linked']))
    (roots['linked']/'fixture.py').write_text('def linkedUnique651():\n    return "linked"\n')
    commit(roots['linked'])
    roots['independent'].mkdir()
    git(roots['independent'], 'init', '-q')
    (roots['independent']/'fixture.py').write_text('def independentUnique651():\n    return "independent"\n')
    commit(roots['independent'])
    for name, root in roots.items():
        symbol = name+'Unique651'
        record = dict(checkout=str(root), sourceFiles=1,
                      sourceBytes=(root/'fixture.py').stat().st_size)
        record['codegraphCold'] = checked([NODE, CLI, 'init', root, '--yes'], root)
        record['crgCold'] = crg(root, 'build')
        assert record['crgCold']['exit'] == 0, record['crgCold']
        before = snapshot(root)
        record['codegraphWarmReadOnly'] = readcg(root, symbol)
        after_cg = snapshot(root)
        record['codegraphReadOnlyBytesUnchanged'] = before == after_cg
        record['codegraphReadOnlyChangedFiles'] = [f for f in sorted(set(before)|set(after_cg)) if before.get(f) != after_cg.get(f)]
        before_status = snapshot(root)
        record['crgWarmStatus'] = crg(root, 'status', '--json')
        after_status = snapshot(root)
        record['crgStatusChangedFiles'] = [f for f in sorted(set(before_status)|set(after_status)) if before_status.get(f) != after_status.get(f)]
        record['crgQuery'] = crg(root, 'search', symbol, '--limit', '10')
        record['warmIndexBytesUnchanged'] = before == snapshot(root)
        assert symbol in record['codegraphWarmReadOnly']['stdout']
        assert symbol in record['crgQuery']['stdout']
        other = 'linkedUnique651' if name != 'linked' else 'mainUnique651'
        record['codegraphOtherCheckoutQuery'] = readcg(root, other)
        record['crgOtherCheckoutQuery'] = crg(root, 'search', other, '--limit', '10')
        assert json.loads(record['codegraphOtherCheckoutQuery']['stdout'])['results'] == []
        assert json.loads(record['crgOtherCheckoutQuery']['stdout'])['results'] == []
        # An untracked supported source is outside every old explicit manifest.
        (root/'new-supported.py').write_text(f'def outsideManifest{name}651():\n    return "dirty"\n')
        record['dirtyCodegraphNativeState'] = readcg(root, 'outsideManifest'+name+'651')
        record['dirtyCrgStatus'] = crg(root, 'status', '--json')
        assert json.loads(record['dirtyCodegraphNativeState']['stdout'])['extractionStale'] is False
        assert json.loads(record['dirtyCodegraphNativeState']['stdout'])['results'] == []
        record['dirtyCrgQuery'] = crg(root, 'search', 'outsideManifest'+name+'651', '--limit', '10')
        record['codegraphFullSourceScan'] = readcg(root, 'outsideManifest'+name+'651', True)
        assert json.loads(record['dirtyCrgQuery']['stdout'])['results'] == []
        report['fixtures'].append(record)
        (directory/'evidence.json').write_text(json.dumps(report, indent=2))

    # This is the actual backend FileLock, held by a separate living process,
    # not an integration-owned fixture lock or a hand-authored PID file.
    cold = directory/'foreign-cold'
    cold.mkdir()
    git(cold, 'init', '-q')
    (cold/'fixture.py').write_text('def foreignCold651():\n    return 651\n')
    holder = foreign_lock(cold)
    lock = cold/'.codegraph/codegraph.lock'
    before = lock.read_bytes()
    try:
        record = dict(holderPid=holder.pid, databaseBefore=(cold/'.codegraph/codegraph.db').exists())
        record['nativeInitializeUnderForeignLock'] = run([NODE, CLI, 'init', cold, '--yes'], cold)
        record['databaseAfter'] = (cold/'.codegraph/codegraph.db').exists()
        record['foreignLockUnchanged'] = before == lock.read_bytes()
        record['foreignHolderAlive'] = holder.poll() is None
        assert record['databaseBefore'] is False
        assert record['databaseAfter'] is True
        assert record['foreignLockUnchanged'] and record['foreignHolderAlive']
        report['codegraphColdWritesBeforeNativeLock'] = record
    finally:
        release(holder)
    api = roots['main']
    holder = foreign_lock(api, bulk=True)
    lock = api/'.codegraph/codegraph.lock'
    before = lock.read_bytes()
    try:
        record = dict(holderPid=holder.pid)
        record['nativeTriggersBefore'] = checked([NODE, '-e', CG_TRIGGERS, LIB, api], api)
        record['nativeSyncUnderForeignBulkWriter'] = run([NODE, CLI, 'sync', api], api)
        record['nativeTriggersAfter'] = checked([NODE, '-e', CG_TRIGGERS, LIB, api], api)
        record['foreignLockUnchanged'] = before == lock.read_bytes()
        record['foreignHolderAlive'] = holder.poll() is None
        assert json.loads(record['nativeTriggersBefore']['stdout']) == []
        assert json.loads(record['nativeTriggersAfter']['stdout']) == [{'name': 'nodes_ai'}]
        assert record['nativeSyncUnderForeignBulkWriter']['exit'] == 1
        assert record['foreignLockUnchanged'] and record['foreignHolderAlive']
        report['codegraphSyncWritesBeforeNativeLock'] = record
    finally:
        release(holder)
    report['ownedHolderCancellation'] = {'signal': 'SIGTERM', 'holderExit': holder.returncode,
        'nativeLockReleasedByHolder': not lock.exists(), 'preparationJobCancellation': 'not-established'}
    record = checked([NODE, '-e', """const sdk=require(process.argv[1]+'/index.js');
(async()=>{const l=new sdk.FileLock(process.argv[2]+'/.codegraph/codegraph.lock');
l.acquire();let reacquire;try{l.acquire();reacquire='accepted';}catch(e){reacquire=e.message;}
try{const g=await sdk.default.open(process.argv[2]);
try{let sync;try{await g.sync();sync='accepted';}catch(e){sync=e.message;}
const index=await g.indexAll();console.log(JSON.stringify({reacquire,sync,index}));
}finally{g.destroy();}}finally{l.release();}})().catch(e=>{console.error(e);process.exitCode=1;});
""", LIB, api], api)
    output = json.loads(record['stdout'])
    assert 'locked by another' in output['reacquire']
    assert 'could not acquire' in output['sync']
    assert output['index']['success'] is False
    report['codegraphAcquireBeforeOpenApi'] = record

    record = checked([CRG, '-B', '-c', """import json,sqlite3,sys
from pathlib import Path
from code_review_graph.graph import GraphStore
p=Path(sys.argv[1])/'transaction-api.db'
s=GraphStore(p)
# Test the proposed enclosing transaction, without changing native methods.
# The connection is private; this is a diagnostic of feasibility, not a supported API.
s._conn.execute('BEGIN IMMEDIATE')
s.set_metadata('metadata-owner-probe','committed')
metadata_released = not s._conn.in_transaction
s._conn.execute('BEGIN IMMEDIATE')
s._conn.execute("INSERT INTO metadata(key,value) VALUES ('outer-owner-probe','uncommitted')")
s.store_file_nodes_edges(str(Path(sys.argv[1])/'fixture.py'),[],[])
marker=s.get_metadata('outer-owner-probe')
other=sqlite3.connect(str(p),timeout=0)
other.execute('BEGIN IMMEDIATE')
print(json.dumps({'metadataCommitReleasedOuterTransaction':metadata_released,'outerMarkerAfterNativeFileWrite':marker,'otherWriterAcquired':True,
'nativeConnectionInTransaction':s._conn.in_transaction}))
other.rollback();other.close();s.close()
""", directory], directory)
    output = json.loads(record['stdout'])
    assert output['outerMarkerAfterNativeFileWrite'] is None
    assert output['nativeConnectionInTransaction'] is False
    assert output['otherWriterAcquired'] is True
    report['crgEnclosingTransactionApi'] = record
    report['evidenceOnly'] = True
    (directory/'evidence.json').write_text(json.dumps(report, indent=2))
    (BASE/'graphs-native-evidence.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evidence': str(directory/'evidence.json'), 'supported': False}))


if __name__ == '__main__':
    main()
