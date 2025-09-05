#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  const {
    format = 'auto',  // 'zip', 'tar.gz', or 'auto'
    outputDir = '.',
    outputName = null,  // Custom output name
    includeBinary = true
  } = options;
  
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`);
  }
  
  const binaryName = path.basename(binaryPath);
  const binaryDir = path.dirname(binaryPath);
  const baseName = binaryName.replace(/\.(exe)?$/, '');
  
  // Determine archive format
  let archiveFormat = format;
  if (format === 'auto') {
    archiveFormat = detectPlatform() === 'windows' ? 'zip' : 'tar.gz';
  }
  
  const originalSize = getFileSize(binaryPath);
  console.log(`📦 Creating ${archiveFormat} archive for ${binaryName}...`);
  console.log(`📊 Original size: ${originalSize} MB`);
  
  let archiveName;
  let archiveCommand;
  
  if (archiveFormat === 'zip') {
    archiveName = `${baseName}.zip`;
    // Use cross-platform zip command or fallback to PowerShell on Windows
    if (process.platform === 'win32') {
      archiveCommand = `powershell -Command "Compress-Archive -Path '${binaryName}' -DestinationPath '${archiveName}' -CompressionLevel Optimal -Force"`;
    } else {
      // Use zip command on Unix-like systems
      archiveCommand = `zip -9 -q ${archiveName} ${binaryName}`;
    }
  } else {
    // tar.gz format
    archiveName = `${baseName}.tar.gz`;
    archiveCommand = `tar -czf ${archiveName} ${binaryName}`;
  }
  
  const archivePath = path.join(outputDir, archiveName);
  
  try {
    // Change to binary directory to avoid path issues
    const oldCwd = process.cwd();
    process.chdir(binaryDir);
    
    // Remove existing archive if it exists
    if (fs.existsSync(archiveName)) {
      fs.unlinkSync(archiveName);
    }
    
    // Create archive
    execSync(archiveCommand, { stdio: 'inherit' });
    
    // Move archive to output directory if different
    if (binaryDir !== path.resolve(outputDir)) {
      const targetPath = path.join(outputDir, archiveName);
      fs.renameSync(archiveName, targetPath);
    }
    
    process.chdir(oldCwd);
    
    // Calculate compression stats
    if (fs.existsSync(archivePath)) {
      const archiveSize = getFileSize(archivePath);
      const savings = ((originalSize - archiveSize) / originalSize * 100).toFixed(1);
      
      console.log(`📊 Archive size: ${archiveSize} MB`);
      console.log(`💾 Space saved: ${savings}%`);
      console.log(`✅ Archive created: ${archiveName}`);
      
      return archivePath;
    } else {
      throw new Error('Archive was not created successfully');
    }
    
  } catch (error) {
    console.error(`❌ Archive creation failed:`, error.message);
    throw error;
  }
}

function archiveAllBinaries(directory = '.', options = {}) {
  const binaryPatterns = ['1mcp', '1mcp.exe'];
  const binaries = [];
  
  binaryPatterns.forEach(pattern => {
    const fullPath = path.join(directory, pattern);
    if (fs.existsSync(fullPath)) {
      binaries.push(fullPath);
    }
  });
  
  // Also look for platform-specific binaries
  const platformBinaries = fs.readdirSync(directory)
    .filter(f => f.startsWith('1mcp-') && !f.includes('.'))
    .map(f => path.join(directory, f));
  
  binaries.push(...platformBinaries);
  
  if (binaries.length === 0) {
    console.log('📂 No binaries found to archive');
    return [];
  }
  
  console.log(`📦 Found ${binaries.length} binaries to archive`);
  
  const archives = [];
  binaries.forEach(binary => {
    try {
      const archive = createArchive(binary, options);
      archives.push(archive);
    } catch (error) {
      console.error(`❌ Failed to archive ${binary}:`, error.message);
    }
  });
  
  return archives;
}

if (require.main === module) {
  const target = process.argv[2];
  const format = process.argv[3] || 'auto';
  
  if (target && fs.existsSync(target)) {
    // Archive specific binary
    createArchive(target, { format });
  } else {
    // Archive all found binaries
    archiveAllBinaries('.', { format });
  }
}

module.exports = { createArchive, archiveAllBinaries };