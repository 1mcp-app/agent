#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Archive binaries for distribution using zip/tar.gz compression
 */

function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / 1024 / 1024).toFixed(2); // MB
}

function detectPlatform() {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function createArchive(binaryPath, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      format = 'auto', // 'zip', 'tar.gz', or 'auto'
      outputDir = '.',
    } = options;

    if (!fs.existsSync(binaryPath)) {
      return reject(new Error(`Binary not found: ${binaryPath}`));
    }

    const binaryName = path.basename(binaryPath);
    const baseName = binaryName.replace(/\.(exe)?$/, '');

    // Validate and sanitize the base name for filename safety
    if (!/^[a-zA-Z0-9._-]+$/.test(baseName)) {
      return reject(
        new Error(
          `Invalid binary name: ${baseName}. Only alphanumeric characters, dots, underscores and hyphens allowed.`,
        ),
      );
    }

    // Determine archive format
    let archiveFormat = format;
    if (format === 'auto') {
      archiveFormat = detectPlatform() === 'windows' ? 'zip' : 'tar';
    }

    const originalSize = getFileSize(binaryPath);
    console.log(`📦 Creating ${archiveFormat} archive for ${binaryName}...`);
    console.log(`📊 Original size: ${originalSize} MB`);

    const archiveName = archiveFormat === 'zip' ? `${baseName}.zip` : `${baseName}.tar.gz`;
    const archivePath = path.join(outputDir, archiveName);

    // Remove existing archive if it exists
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    // Create output stream
    const output = fs.createWriteStream(archivePath);
    let archive;

    if (archiveFormat === 'zip') {
      archive = archiver('zip', { zlib: { level: 9 } });
    } else {
      archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
    }

    // Handle errors
    archive.on('error', (err) => {
      reject(new Error(`Archive creation failed: ${err.message}`));
    });

    output.on('close', () => {
      try {
        // Calculate compression stats
        const archiveSize = getFileSize(archivePath);
        const savings = (((originalSize - archiveSize) / originalSize) * 100).toFixed(1);

        console.log(`📊 Archive size: ${archiveSize} MB`);
        console.log(`💾 Space saved: ${savings}%`);
        console.log(`✅ Archive created: ${archiveName}`);

        resolve(archivePath);
      } catch (error) {
        reject(error);
      }
    });

    output.on('error', (err) => {
      reject(new Error(`Failed to write archive: ${err.message}`));
    });

    // Pipe archive data to the output file
    archive.pipe(output);

    // Add the binary file to the archive
    archive.file(binaryPath, { name: binaryName });

    // Finalize the archive
    archive.finalize();
  });
}

async function archiveAllBinaries(directory = '.', options = {}) {
  const binaryPatterns = ['1mcp', '1mcp.exe'];
  const binaries = [];

  binaryPatterns.forEach((pattern) => {
    const fullPath = path.join(directory, pattern);
    if (fs.existsSync(fullPath)) {
      binaries.push(fullPath);
    }
  });

  // Also look for platform-specific binaries
  const platformBinaries = fs
    .readdirSync(directory)
    .filter((f) => f.startsWith('1mcp-') && (f.endsWith('.exe') || !f.includes('.')))
    .map((f) => path.join(directory, f));

  binaries.push(...platformBinaries);

  if (binaries.length === 0) {
    console.log('📂 No binaries found to archive');
    return [];
  }

  console.log(`📦 Found ${binaries.length} binaries to archive`);

  const archives = [];
  for (const binary of binaries) {
    try {
      const archive = await createArchive(binary, options);
      archives.push(archive);
    } catch (error) {
      console.error(`❌ Failed to archive ${binary}:`, error.message);
    }
  }

  return archives;
}

if (require.main === module) {
  const target = process.argv[2];
  const format = process.argv[3] || 'auto';

  (async () => {
    try {
      if (target && fs.existsSync(target)) {
        // Archive specific binary
        await createArchive(target, { format });
      } else {
        // Archive all found binaries
        await archiveAllBinaries('.', { format });
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = { createArchive, archiveAllBinaries };
