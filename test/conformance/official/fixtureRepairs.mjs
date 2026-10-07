import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Published alpha.11 distribution from conformance c321dd32035556e6769d3724a8ee97d87c3faaac.
// Replacement counts and the original checksum bind these edits to that exact source.
export const ORIGINAL_TOOLKIT_DIGEST = 'a10085d0cfc9dd9192cc227f0f4dd6f1af9a94f6a0d3e30af08d4a0bcf268aae';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function repairToolkit(source) {
  if (digest(source) !== ORIGINAL_TOOLKIT_DIGEST) throw new Error('Official toolkit source mismatch');
  const repairs = [];
  const replace = (id, before, after, expected) => {
    const count = source.split(before).length - 1;
    if (count !== expected) throw new Error(`Official toolkit repair mismatch: ${id}`);
    source = source.split(before).join(after);
    repairs.push({ id, replacements: count });
  };
  // Modern Result requires a discriminator. Retain completed-result/no-retry coverage;
  // rejection of malformed omitted-discriminator peers remains a separate negative control.
  replace(
    'modern-complete-result',
    'result:{content:[{type:`text`,text:`no-result-type-test-ok`}]}',
    'result:{resultType:`complete`,content:[{type:`text`,text:`explicit-result-type-test-ok`}]}',
    1,
  );
  replace(
    'modern-complete-check-id',
    'sep-2322-default-result-type-complete',
    'sep-2322-explicit-result-type-complete',
    2,
  );
  replace('modern-complete-check-name', 'DefaultResultTypeComplete', 'ExplicitResultTypeComplete', 2);
  replace(
    'modern-complete-check-description',
    'Client MUST assume resultType "complete" when not specified',
    'Client completes a resultType "complete" result without retrying inputResponses',
    2,
  );
  replace(
    'modern-complete-check-error',
    'Client retried with inputResponses even though the result had no resultType (should default to complete)',
    'Client retried with inputResponses after an explicit complete result',
    1,
  );
  // Boolean-only schemas cannot admit null. The existing null/omitted case now uses
  // a schema-valid omitted optional value. Null header encoding/rejection has owned tests.
  replace('schema-valid-omission', 'priority:1,verbose:null,query:`SELECT 1`', 'priority:1,query:`SELECT 1`', 1);
  // The modern header scenario uses discovery, not the legacy handshake. The
  // base scaffold must observe discovery headers before its early response.
  replace(
    'standard-header-protocol-context',
    'Ia=class{constructor(){this.source={introducedIn:F},this.server=null,this.checks=[],this.port=0,this.sessionId=`session-${Date.now()}`}async start(e){',
    'Ia=class{constructor(){this.source={introducedIn:F},this.server=null,this.checks=[],this.port=0,this.sessionId=`session-${Date.now()}`}async start(e){this.ownedSpecVersion=e.specVersion;',
    1,
  );
  replace(
    'standard-header-discovery-observer',
    'if(r.method===`server/discover`){this.sendDiscover(t,r);return}',
    'if(r.method===`server/discover`){if(this.name===`http-standard-headers`)this.checkMcpMethodHeader(e,r);this.sendDiscover(t,r);return}',
    1,
  );
  replace(
    'standard-header-handshake-inventory',
    'getChecks(){let e=[...this.checks];for(let t of[`initialize`,`notifications/initialized`,',
    'getChecks(){let e=[...this.checks];for(let t of[...(this.ownedSpecVersion===F?[`server/discover`]:[`initialize`,`notifications/initialized`]),',
    1,
  );
  // These values come from the scenario's own lifecycle objects, not PRM or AS responses.
  replace(
    'metadata-owned-issuer',
    '{serverUrl:`${n.getUrl()}/mcp`}',
    '{serverUrl:`${n.getUrl()}/mcp`,context:{ownedOAuthIssuer:c()}}',
    1,
  );
  const plain = '{serverUrl:`${this.server.getUrl()}/mcp`}';
  replace(
    'scenario-owned-issuer',
    plain,
    '{serverUrl:`${this.server.getUrl()}/mcp`,context:{ownedOAuthIssuer:this.authServer?.getUrl()??this.as1?.getUrl(),ownedOAuthNextIssuer:this.as2?.getUrl(),ownedOAuthReject:!!this.allowClientError,client_metadata_url:this.name===`auth/basic-cimd`?_i:undefined}}',
    21,
  );
  replace(
    'credential-scenario-owned-issuer',
    'context:{client_id:',
    'context:{ownedOAuthIssuer:this.authServer?.getUrl(),client_id:',
    5,
  );
  return { source, repairs };
}

export async function prepareToolkitRepairs(packageRoot, outputDirectory) {
  const original = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
  const repaired = repairToolkit(original);
  const repairedDigest = digest(repaired.source);
  // Keeping this beside the installed entry preserves its external package resolution.
  // The pristine index.js and requirement YAMLs are never overwritten.
  const entryPoint = join(packageRoot, 'dist', `owned-${repairedDigest}.mjs`);
  try {
    await writeFile(entryPoint, repaired.source, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (digest(await readFile(entryPoint)) !== repairedDigest)
      throw new Error('Official toolkit repair artifact mismatch');
  }
  const receipt = {
    schemaVersion: 1,
    package: '@modelcontextprotocol/conformance',
    version: '0.2.0-alpha.11',
    sourceCommit: 'c321dd32035556e6769d3724a8ee97d87c3faaac',
    originalDigest: ORIGINAL_TOOLKIT_DIGEST,
    repairedDigest,
    repairs: repaired.repairs,
  };
  await writeFile(
    join(outputDirectory, 'official-toolkit-repairs.json'),
    JSON.stringify({ ...receipt, digest: digest(JSON.stringify(receipt)) }, null, 2) + '\n',
    {
      mode: 0o600,
    },
  );
  return entryPoint;
}
