import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');

const exists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const writeJson = async (filePath, data) => {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const ensureFile = async (filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
};

const defaultClientCjsShim = `'use strict';
const mod = require('../index.cjs');
const client = mod.Client ?? mod.CommonClient ?? mod.default ?? mod;
module.exports = client;
module.exports.default = client;
`;

const defaultClientJsShim = `'use strict';
module.exports = require('./client.cjs');
`;

const defaultWebsocketCjsShim = `'use strict';
const mod = require('../../index.cjs');
const websocket = mod.WebSocket ?? mod.default ?? mod;
module.exports = websocket;
module.exports.default = websocket;
`;

const defaultWebsocketJsShim = `'use strict';
module.exports = require('./websocket.cjs');
`;

const findRpcWebsocketPackages = async () => {
  const found = [];
  const stack = [nodeModulesRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const nextPath = path.join(current, entry.name);
      if (entry.name === 'rpc-websockets') {
        const packageJsonPath = path.join(nextPath, 'package.json');
        if (await exists(packageJsonPath)) {
          found.push(nextPath);
        }
        continue;
      }

      if (entry.name.startsWith('@')) {
        stack.push(nextPath);
        continue;
      }

      if (entry.name === '.bin') {
        continue;
      }

      if (entry.name === 'node_modules') {
        stack.push(nextPath);
        continue;
      }

      const nestedNodeModules = path.join(nextPath, 'node_modules');
      if (await exists(nestedNodeModules)) {
        stack.push(nestedNodeModules);
      }
    }
  }

  return found;
};

const patchExports = (pkg) => {
  if (pkg.exports === undefined) {
    return pkg;
  }

  let exportsField = pkg.exports;
  if (typeof exportsField === 'string') {
    exportsField = { '.': exportsField };
  }

  if (typeof exportsField !== 'object' || Array.isArray(exportsField) || exportsField === null) {
    return pkg;
  }

  const keys = Object.keys(exportsField);
  const hasSubpathKeys = keys.some((key) => key.startsWith('.'));
  const hasConditionKeys = keys.some((key) => !key.startsWith('.'));

  if (hasSubpathKeys && hasConditionKeys) {
    const conditionEntries = Object.fromEntries(
      keys
        .filter((key) => !key.startsWith('.'))
        .map((key) => [key, exportsField[key]]),
    );
    const subpathEntries = Object.fromEntries(
      keys
        .filter((key) => key.startsWith('.'))
        .map((key) => [key, exportsField[key]]),
    );
    exportsField = {
      '.': conditionEntries,
      ...subpathEntries,
    };
  } else if (keys.length > 0 && keys.every((key) => !key.startsWith('.'))) {
    exportsField = { '.': exportsField };
  }

  const mapped = {
    ...exportsField,
    './dist/lib/client': './dist/lib/client.js',
    './dist/lib/client.js': './dist/lib/client.js',
    './dist/lib/client.cjs': './dist/lib/client.cjs',
    './dist/lib/client/websocket': './dist/lib/client/websocket.js',
    './dist/lib/client/websocket.js': './dist/lib/client/websocket.js',
    './dist/lib/client/websocket.cjs': './dist/lib/client/websocket.cjs',
  };

  return { ...pkg, exports: mapped };
};

const patchPackage = async (packageDir) => {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const pkg = await readJson(packageJsonPath);
  const distLibDir = path.join(packageDir, 'dist', 'lib');
  const existingClientCjs = path.join(distLibDir, 'client.cjs');
  const existingWebsocketCjs = path.join(distLibDir, 'client', 'websocket.cjs');

  await ensureFile(
    existingClientCjs,
    (await exists(existingClientCjs))
      ? await fs.readFile(existingClientCjs, 'utf8')
      : defaultClientCjsShim,
  );
  await ensureFile(path.join(distLibDir, 'client.js'), defaultClientJsShim);

  await ensureFile(
    existingWebsocketCjs,
    (await exists(existingWebsocketCjs))
      ? await fs.readFile(existingWebsocketCjs, 'utf8')
      : defaultWebsocketCjsShim,
  );
  await ensureFile(path.join(distLibDir, 'client', 'websocket.js'), defaultWebsocketJsShim);

  const patched = patchExports(pkg);
  if (JSON.stringify(pkg) !== JSON.stringify(patched)) {
    await writeJson(packageJsonPath, patched);
  }
};

const main = async () => {
  if (!(await exists(nodeModulesRoot))) {
    return;
  }

  const packages = await findRpcWebsocketPackages();
  await Promise.all(packages.map((packageDir) => patchPackage(packageDir)));
  if (packages.length > 0) {
    console.log(`patched rpc-websockets compatibility in ${packages.length} location(s)`);
  }
};

main().catch((error) => {
  console.error('failed to patch rpc-websockets compatibility', error);
  process.exitCode = 1;
});
