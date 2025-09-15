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
    execSync([
      'esbuild build/index.js',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--outfile=build/bundled.cjs',
      '--external:fsevents',
      '--external:@esbuild/*',
      '--keep-names',
      '--legal-comments=none',
      '--tree-shaking'
    ].join(' '), { stdio: 'inherit' });

    // 3.5. Copy tiktoken WASM files for SEA compatibility
    console.log('📦 Copying tiktoken WASM files...');
    const tiktokenPath = require.resolve('tiktoken');
    const tiktokenDir = require('path').dirname(tiktokenPath);
    const wasmFiles = [
      'tiktoken_bg.wasm',
      'lite/tiktoken_bg.wasm'
    ];

    for (const wasmFile of wasmFiles) {
      const srcPath = require('path').join(tiktokenDir, wasmFile);
      const destPath = require('path').join('build', wasmFile);

      try {
        // Ensure destination directory exists
        const destDir = require('path').dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        // Copy WASM file
        fs.copyFileSync(srcPath, destPath);
        console.log(`✅ Copied ${wasmFile}`);
      } catch (error) {
        console.warn(`⚠️  Failed to copy ${wasmFile}:`, error.message);
      }
    }
    
    // Post-process: Fix import_meta.url and tiktoken WASM path references for SEA compatibility
    console.log('🔧 Fixing import_meta.url and tiktoken paths...');
    let bundledCode = fs.readFileSync('build/bundled.cjs', 'utf8');

    // Replace import_meta variations with proper fallback for SEA
    bundledCode = bundledCode.replace(
      /import_meta\d*\.url/g,
      '(typeof __filename !== "undefined" ? "file://" + __filename : "file:///sea")'
    );

    // Fix tiktoken WASM loading - redirect to build directory when bundled
    bundledCode = bundledCode.replace(
      /path\.join\(__dirname,\s*["']\.\/tiktoken_bg\.wasm["']\)/g,
      'require("path").join(require("path").dirname(process.argv[1] || __filename), "tiktoken_bg.wasm")'
    );

    bundledCode = bundledCode.replace(
      /path\.join\(__dirname,\s*["']\.\/lite\/tiktoken_bg\.wasm["']\)/g,
      'require("path").join(require("path").dirname(process.argv[1] || __filename), "lite", "tiktoken_bg.wasm")'
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