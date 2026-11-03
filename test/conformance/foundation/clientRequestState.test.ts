import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { startConformanceMock } from '../fixtures/typescript/test/mock-peer.mjs';

const execFileAsync = promisify(execFile);

function ownedWireWrapper(args: readonly string[], capturePath: string, timeoutMs = 25_000): string {
  return `import {createServer,request} from 'node:http';
import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';
const target=new URL(process.argv[2]);const frames=[];
const server=createServer((req,res)=>{
 const requestChunks=[];req.on('data',chunk=>requestChunks.push(chunk));
 const outgoing=request(target,{method:req.method,headers:{...req.headers,host:target.host}},incoming=>{
  const responseChunks=[];incoming.on('data',chunk=>responseChunks.push(chunk));
  incoming.on('end',()=>{
   let sent,received;try{sent=JSON.parse(Buffer.concat(requestChunks));}catch{}try{received=JSON.parse(Buffer.concat(responseChunks));}catch{}
   frames.push({method:sent?.method,name:sent?.params?.name,id:sent?.id,authorizationPresent:req.headers.authorization!==undefined,requestStatePresent:sent?.params?.requestState!==undefined,inputResponsesPresent:sent?.params?.inputResponses!==undefined,resultType:received?.result?.resultType??'absent'});
  });res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
 });outgoing.on('error',()=>{res.writeHead(502).end();});req.pipe(outgoing);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(process.execPath,${JSON.stringify(args)}.concat('http://127.0.0.1:'+server.address().port+'/mcp'),{env:process.env,detached:process.platform!=='win32',stdio:['ignore','inherit','inherit']});
const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1));});
const signalGroup=signal=>{if(!child.pid)return;try{process.kill(-child.pid,signal);}catch{}};
const forceStop=async()=>{
 if(!child.pid)return;
 if(process.platform!=='win32'){signalGroup('SIGKILL');return;}
 await new Promise(resolve=>{
  const stop=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
  const limit=setTimeout(()=>stop.kill('SIGKILL'),3000);
  const done=()=>{clearTimeout(limit);resolve();};stop.once('error',done);stop.once('close',done);
 });
};
let timer,forceTimer;try{
 timer=setTimeout(()=>{
  if(process.platform==='win32'){void forceStop();return;}
  signalGroup('SIGTERM');forceTimer=setTimeout(()=>void forceStop(),2000);
 },${timeoutMs});
 const code=await closed;
 process.exitCode=code;
}finally{
 clearTimeout(timer);clearTimeout(forceTimer);
 // The leader may have exited while its descendants still own streams.
 await forceStop();await closed.catch(()=>undefined);
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await writeFile(${JSON.stringify(capturePath)},JSON.stringify(frames));
}
`;
}

it('terminates a stalled owned wire-wrapper child and its descendant on timeout', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'official-client-owned-timeout-'));
  const wrapper = join(scratch, 'wrapper.mjs');
  const stalled = join(scratch, 'stalled.mjs');
  const pidsPath = join(scratch, 'pids.json');
  let pids: number[] = [];
  await writeFile(
    stalled,
    `import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
await writeFile(${JSON.stringify(pidsPath)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);
`,
  );
  await writeFile(wrapper, ownedWireWrapper([stalled], join(scratch, 'wire.json'), 1000));
  try {
    await expect(
      execFileAsync(process.execPath, [wrapper, 'http://127.0.0.1:9/mcp'], { timeout: 10_000 }),
    ).rejects.toMatchObject({ code: 1 });
    pids = JSON.parse(await readFile(pidsPath, 'utf8'));
    expect(pids).toHaveLength(2);
    await vi.waitFor(() => {
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    });
    expect(JSON.parse(await readFile(join(scratch, 'wire.json'), 'utf8'))).toEqual([]);
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* Already closed. */
      }
    }
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

it('preserves request state and isolates interleaved operations through the authenticated gateway', async () => {
  const root = process.cwd();
  const scratch = await mkdtemp(join(tmpdir(), 'gateway-request-state-'));
  const names = ['test_mrtr_echo_state', 'test_mrtr_no_state', 'test_mrtr_unrelated', 'test_mrtr_no_result_type'];
  const mock = await startConformanceMock('2026-07-28', {
    tools: names.map((name) => ({ name, inputSchema: { type: 'object' } })),
    requestState: true,
  });
  try {
    await execFileAsync(
      process.execPath,
      [
        join(root, 'test/conformance/foundation/officialClientBridge.mjs'),
        join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs'),
        join(root, 'build/index.js'),
        join(scratch, 'statuses'),
        mock.endpoint,
      ],
      {
        cwd: root,
        timeout: 40_000,
        env: {
          ...process.env,
          CODEX_SESSION_ID: '',
          CODEX_THREAD_ID: '',
          MCP_CONFORMANCE_SCENARIO: 'sep-2322-client-request-state',
          MCP_CONFORMANCE_PROTOCOL_VERSION: '2026-07-28',
        },
      },
    ).catch(async (error: Error) => {
      const status = await readFile(join(scratch, 'statuses', 'sep-2322-client-request-state.json'), 'utf8').catch(
        () => 'no status',
      );
      throw new Error(`${error.message}; status=${status}`);
    });
    const calls = mock.requests.filter(
      ({ message }: { message: { method: string } }) => message.method === 'tools/call',
    );
    expect(calls.map(({ message }: { message: { params: { name: string } } }) => message.params.name)).toEqual([
      'test_mrtr_echo_state',
      'test_mrtr_unrelated',
      'test_mrtr_echo_state',
      'test_mrtr_no_state',
      'test_mrtr_no_state',
      'test_mrtr_no_result_type',
    ]);
    expect(calls[2].message.params).toMatchObject({
      requestState: 'opaque-state',
      inputResponses: { confirmation: { action: 'accept' } },
    });
    expect(calls[2].message.id).not.toBe(calls[0].message.id);
    expect(calls[1].message.params).not.toHaveProperty('requestState');
    expect(calls[4].message.params).toHaveProperty('inputResponses');
    expect(calls[4].message.params).not.toHaveProperty('requestState');
    expect(calls[5].message.params).not.toHaveProperty('requestState');
    expect(
      mock.requests.every(({ headers }: { headers: Record<string, unknown> }) => headers.authorization === undefined),
    ).toBe(true);
  } finally {
    await mock.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 45_000);
