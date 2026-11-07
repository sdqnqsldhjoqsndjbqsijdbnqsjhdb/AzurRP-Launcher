'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const EXECUTABLE = process.platform === 'win32' ? 'java.exe' : 'java';
const cache = new Map();

function run(file, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

function parseVersion(output) {
  const match = output.match(/(?:java|openjdk)\s+version\s+"([^"]+)"/i) || output.match(/version\s+"([^"]+)"/i);
  if (!match) return null;
  const raw = match[1];
  const first = raw.split(/[._+-]/)[0];
  const major = raw.startsWith('1.') ? Number.parseInt(raw.split('.')[1], 10) : Number.parseInt(first, 10);
  if (!Number.isFinite(major)) return null;
  let vendor = 'Java';
  if (/temurin|adoptium/i.test(output)) vendor = 'Eclipse Temurin';
  else if (/zulu/i.test(output)) vendor = 'Azul Zulu';
  else if (/corretto/i.test(output)) vendor = 'Amazon Corretto';
  else if (/microsoft/i.test(output)) vendor = 'Microsoft OpenJDK';
  else if (/graalvm/i.test(output)) vendor = 'GraalVM';
  else if (/openjdk/i.test(output)) vendor = 'OpenJDK';
  else if (/oracle/i.test(output)) vendor = 'Oracle';
  return { version: raw, major, vendor };
}

async function inspect(file) {
  const key = process.platform === 'win32' ? file.toLowerCase() : file;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return null;
    const output = await run(file, ['-version']);
    if (output.ok || output.stderr) {
      const parsed = parseVersion(`${output.stdout}\n${output.stderr}`);
      if (parsed) {
        result = { path: file, ...parsed, recommended: parsed.major === 8, compatible: parsed.major === 8 };
      }
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}

function addPath(list, seen, candidate) {
  if (!candidate) return;
  const normalized = path.normalize(candidate);
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  if (seen.has(key)) return;
  try {
    if (!fs.statSync(normalized).isFile()) return;
  } catch {
    return;
  }
  seen.add(key);
  list.push(normalized);
}

async function listDirectories(directory) {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function scanWindows(list, seen) {
  const bases = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Java'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Java'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Eclipse Adoptium'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Eclipse Foundation'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Zulu'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Amazon Corretto'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'BellSoft'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Zulu'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.jdks')
  ].filter(Boolean);

  for (const base of bases) {
    addPath(list, seen, path.join(base, 'bin', EXECUTABLE));
    for (const directory of await listDirectories(base)) {
      addPath(list, seen, path.join(directory, 'bin', EXECUTABLE));
      addPath(list, seen, path.join(directory, 'jre', 'bin', EXECUTABLE));
    }
  }
}

async function scanMac(list, seen) {
  const bases = [
    '/Library/Java/JavaVirtualMachines',
    path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines'),
    '/System/Library/Java/JavaVirtualMachines'
  ];
  for (const base of bases) {
    for (const directory of await listDirectories(base)) {
      addPath(list, seen, path.join(directory, 'Contents', 'Home', 'bin', EXECUTABLE));
    }
  }
}

async function scanLinux(list, seen) {
  const bases = [
    '/usr/lib/jvm',
    '/usr/java',
    '/opt/java',
    path.join(os.homedir(), '.sdkman', 'candidates', 'java'),
    path.join(os.homedir(), '.jdks'),
    path.join(os.homedir(), '.gradle', 'jdks')
  ];
  for (const base of bases) {
    addPath(list, seen, path.join(base, 'bin', EXECUTABLE));
    for (const directory of await listDirectories(base)) {
      addPath(list, seen, path.join(directory, 'bin', EXECUTABLE));
    }
  }
}

async function scanGameRuntime(gameDir, list, seen) {
  if (!gameDir) return;
  const runtime = path.join(gameDir, 'runtime');
  addPath(list, seen, path.join(runtime, 'bin', EXECUTABLE));
  for (const versionDir of await listDirectories(runtime)) {
    addPath(list, seen, path.join(versionDir, 'bin', EXECUTABLE));
    for (const directory of await listDirectories(versionDir)) {
      addPath(list, seen, path.join(directory, 'bin', EXECUTABLE));
      addPath(list, seen, path.join(directory, 'Contents', 'Home', 'bin', EXECUTABLE));
    }
  }
}

async function pathJava(list, seen) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await run(command, ['java'], 3000);
  if (!result.stdout) return;
  for (const line of result.stdout.split(/\r?\n/)) {
    addPath(list, seen, line.trim());
  }
}

async function inspectInput(input) {
  try {
    const stat = await fsp.stat(input);
    if (stat.isDirectory()) {
      for (const candidate of [
        path.join(input, 'bin', EXECUTABLE),
        path.join(input, 'Contents', 'Home', 'bin', EXECUTABLE)
      ]) {
        const info = await inspect(candidate);
        if (info) return info;
      }
      return null;
    }
  } catch {
    return null;
  }
  return inspect(input);
}

async function listCandidates({ customPath = '', gameDir = '' } = {}) {
  const list = [];
  const seen = new Set();

  if (customPath) {
    const custom = await inspectInput(customPath);
    if (custom) {
      const normalized = path.normalize(custom.path);
      seen.add(process.platform === 'win32' ? normalized.toLowerCase() : normalized);
      list.push(normalized);
    }
  }
  if (process.env.JAVA_HOME) addPath(list, seen, path.join(process.env.JAVA_HOME, 'bin', EXECUTABLE));

  if (process.platform === 'win32') await scanWindows(list, seen);
  else if (process.platform === 'darwin') await scanMac(list, seen);
  else await scanLinux(list, seen);

  await scanGameRuntime(gameDir, list, seen);
  await pathJava(list, seen);

  const inspected = [];
  for (const candidate of list) {
    const info = await inspect(candidate);
    if (info) inspected.push(info);
  }
  inspected.sort((a, b) => {
    if (a.major === 8 && b.major !== 8) return -1;
    if (b.major === 8 && a.major !== 8) return 1;
    return b.major - a.major;
  });
  return inspected;
}

async function detectJava(options = {}) {
  const candidates = await listCandidates(options);
  const best = candidates.find((item) => item.major === 8) || candidates[0] || null;
  return { best, candidates };
}

async function resolveJava({ customPath = '', gameDir = '' } = {}) {
  if (customPath) {
    const info = await inspectInput(customPath);
    if (!info) {
      const error = new Error('Le chemin Java personnalisé est introuvable ou invalide.');
      error.code = 'JAVA_INVALID';
      throw error;
    }
    if (info.major !== 8) {
      const error = new Error(`Java 8 est requis pour Minecraft 1.12.2 (détecté : Java ${info.major}).`);
      error.code = 'JAVA_VERSION';
      throw error;
    }
    return info.path;
  }
  const { candidates } = await detectJava({ gameDir });
  return candidates.find((item) => item.major === 8)?.path || null;
}

module.exports = { detectJava, resolveJava, listCandidates };
