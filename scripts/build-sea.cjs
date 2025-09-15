#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Build Single Executable Application (SEA) components
 */
function buildSEA() {
  console.log('🔨 Building SEA components...');

  try {
    // 1. Build TypeScript
    console.log('📦 Building TypeScript...');
    execSync('tsc --project tsconfig.build.json', { stdio: 'inherit' });

    // 2. Set execute permissions on main file
    const mainFile = 'build/index.js';
    if (fs.existsSync(mainFile)) {
      fs.chmodSync(mainFile, '755');
    }

    // 3. Bundle with esbuild (optimized)
    console.log('📦 Bundling with esbuild...');
    execSync(
      [
        'esbuild build/index.js',
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--outfile=build/bundled.cjs',
        '--external:fsevents',
        '--external:@esbuild/*',
        '--keep-names',
        '--legal-comments=none',
        '--tree-shaking',
      ].join(' '),
      { stdio: 'inherit' },
    );

    // 3.5. Prepare tiktoken WASM files for inlining
    console.log('📦 Preparing tiktoken WASM files for inlining...');
    const tiktokenPath = require.resolve('tiktoken');
    const tiktokenDir = require('path').dirname(tiktokenPath);
    const wasmFiles = {
      'tiktoken_bg.wasm': require('path').join(tiktokenDir, 'tiktoken_bg.wasm'),
      'lite/tiktoken_bg.wasm': require('path').join(tiktokenDir, 'lite/tiktoken_bg.wasm'),
    };

    const wasmData = {};
    for (const [wasmKey, srcPath] of Object.entries(wasmFiles)) {
      try {
        // Read WASM file as base64
        const wasmBuffer = fs.readFileSync(srcPath);
        wasmData[wasmKey] = wasmBuffer.toString('base64');
        console.log(`✅ Prepared ${wasmKey} (${Math.round(wasmBuffer.length / 1024)}KB)`);
      } catch (error) {
        console.warn(`⚠️  Failed to prepare ${wasmKey}:`, error.message);
      }
    }

    // Post-process: Fix import_meta.url and tiktoken WASM loading for SEA compatibility
    console.log('🔧 Fixing import_meta.url and inlining tiktoken WASM...');
    let bundledCode = fs.readFileSync('build/bundled.cjs', 'utf8');

    // Replace import_meta variations with proper fallback for SEA
    bundledCode = bundledCode.replace(
      /import_meta\d*\.url/g,
      '(typeof __filename !== "undefined" ? "file://" + __filename : "file:///sea")',
    );

    // Read package.json for version info
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    // Inject inline WASM data and version after the shebang line
    const wasmInjection = `
// Inlined WASM data for SEA compatibility
const __TIKTOKEN_WASM_DATA__ = ${JSON.stringify(wasmData)};

// Inlined version data for SEA compatibility
const __PACKAGE_VERSION__ = ${JSON.stringify(packageJson.version)};
`;

    // Find the shebang line and insert WASM data after it
    const lines = bundledCode.split('\n');
    if (lines[0].startsWith('#!')) {
      lines.splice(1, 0, wasmInjection);
      bundledCode = lines.join('\n');
    } else {
      bundledCode = wasmInjection + bundledCode;
    }

    // Replace tiktoken WASM file reading with inline base64 data
    bundledCode = bundledCode.replace(
      /var bytes = null;\s*for \(const candidate of candidates\) \{\s*try \{\s*bytes = fs\d*\.readFileSync\(candidate\);\s*break;\s*\} catch \{\s*\}\s*\}/g,
      `var bytes = null;
    // Use inlined WASM data for SEA compatibility
    const wasmPath = candidates[0] || '';
    const wasmKey = wasmPath.includes('lite') ? 'lite/tiktoken_bg.wasm' : 'tiktoken_bg.wasm';
    if (typeof __TIKTOKEN_WASM_DATA__ !== 'undefined' && __TIKTOKEN_WASM_DATA__[wasmKey]) {
      bytes = Buffer.from(__TIKTOKEN_WASM_DATA__[wasmKey], 'base64');
    } else {
      // Fallback to file system
      for (const candidate of candidates) {
        try {
          bytes = fs9.readFileSync(candidate);
          break;
        } catch {
        }
      }
    }`,
    );

    fs.writeFileSync('build/bundled.cjs', bundledCode);

    // 4. Create SEA preparation blob
    console.log('🔧 Creating SEA blob...');
    execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

    console.log('✅ SEA build complete!');
  } catch (error) {
    console.error('❌ SEA build failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  buildSEA();
}

module.exports = { buildSEA };
