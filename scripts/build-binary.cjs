#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

/**
 * Platform-specific binary creation using Node.js SEA
 */

const PLATFORM_CONFIGS = {
  'darwin-arm64': {
    output: '1mcp',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp\')"',
      'codesign --remove-signature 1mcp',
      'npx postject 1mcp NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA',
      'codesign --sign - --entitlements entitlements.plist 1mcp',
      'chmod +x 1mcp'
    ]
  },
  'darwin-x64': {
    output: '1mcp',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp\')"',
      'codesign --remove-signature 1mcp',
      'npx postject 1mcp NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA',
      'codesign --sign - --entitlements entitlements.plist 1mcp',
      'chmod +x 1mcp'
    ]
  },
  'linux-x64': {
    output: '1mcp',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp\')"',
      'npx postject 1mcp NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      'chmod +x 1mcp'
    ]
  },
  'linux-arm64': {
    output: '1mcp',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp\')"',
      'npx postject 1mcp NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      'chmod +x 1mcp'
    ]
  },
  'win32-x64': {
    output: '1mcp.exe',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp.exe\')"',
      'npx postject 1mcp.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    ]
  },
  'win32-arm64': {
    output: '1mcp.exe',
    steps: [
      'node -e "require(\'fs\').copyFileSync(process.execPath, \'1mcp.exe\')"',
      'npx postject 1mcp.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    ]
  }
};

function detectPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  
  if (platform === 'darwin') {
    return arch === 'x64' ? 'darwin-x64' : 'darwin-arm64';
  } else if (platform === 'win32') {
    return arch === 'x64' ? 'win32-x64' : 'win32-arm64';
  } else if (platform === 'linux') {
    return arch === 'x64' ? 'linux-x64' : 'linux-arm64';
  }
  
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function buildBinary(targetPlatform) {
  const platform = targetPlatform || detectPlatform();
  const config = PLATFORM_CONFIGS[platform];
  
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  
  console.log(`🔨 Building binary for ${platform}...`);
  
  try {
    // Verify SEA blob exists
    if (!fs.existsSync('sea-prep.blob')) {
      throw new Error('SEA blob not found. Run SEA build first.');
    }
    
    // Execute platform-specific steps
    config.steps.forEach((step, index) => {
      console.log(`📦 Step ${index + 1}/${config.steps.length}: ${step.split(' ')[0]}...`);
      execSync(step, { stdio: 'inherit' });
    });
    
    // Verify binary was created
    if (!fs.existsSync(config.output)) {
      throw new Error(`Binary ${config.output} was not created`);
    }
    
    console.log(`✅ Binary created: ${config.output}`);
    return config.output;
  } catch (error) {
    console.error(`❌ Binary build failed for ${platform}:`, error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  const targetPlatform = process.argv[2];
  buildBinary(targetPlatform);
}

module.exports = { buildBinary, PLATFORM_CONFIGS };