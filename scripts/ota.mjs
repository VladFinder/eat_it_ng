import { createHash, generateKeyPairSync, sign, constants, createPublicKey } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  renameSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const trustPath = join(root, 'src/app/core/ota-trust.json');
export function nativeFingerprint(projectRoot) {
  const files = [
    'capacitor.config.ts',
    'android/build.gradle',
    'android/variables.gradle',
    'android/settings.gradle',
    'android/gradle.properties',
    'android/app/build.gradle',
    'android/capacitor.settings.gradle',
    'android/app/capacitor.build.gradle',
    'android/app/proguard-rules.pro',
  ];
  const walk = (directory) => {
    for (const entry of readdirSync(join(projectRoot, directory), { withFileTypes: true })) {
      if (entry.name === 'assets') continue;
      const path = join(directory, entry.name);
      // cap sync generates this ignored file from capacitor.config.ts, already hashed above.
      if (path === join('android/app/src/main/res/xml', 'config.xml')) continue;
      if (entry.isSymbolicLink()) throw new Error(`Native symlink not allowed: ${path}`);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('android/app/src/main');
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  const nativePackages = Object.entries(pkg.dependencies)
    .filter(([name]) => {
      const metadata = JSON.parse(
        readFileSync(join(projectRoot, 'node_modules', name, 'package.json'), 'utf8'),
      );
      return name.startsWith('@capacitor/') || Boolean(metadata.capacitor?.android);
    })
    .map(([name, range]) => [name, range, lock.packages[`node_modules/${name}`]?.integrity]);
  const hash = createHash('sha256').update(JSON.stringify(nativePackages.sort()));
  for (const file of files.sort()) {
    hash.update(file.split(sep).join('/')).update(readFileSync(join(projectRoot, file)));
  }
  return hash.digest('hex');
}

export function signManifest(payload, privateKey) {
  const data = Buffer.from(JSON.stringify(payload));
  return {
    payload: data.toString('base64'),
    signature: sign('sha256', data, {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString('base64'),
  };
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      runtime: { type: 'string' },
      key: { type: 'string', default: join(root, '.ota/private.pem') },
      output: { type: 'string', default: join(root, '.ota/releases') },
    },
  });
  const command = positionals[0];
  const keyPath = resolve(values.key);
  if (command === 'init') {
    if (existsSync(keyPath) || existsSync(trustPath))
      throw new Error('OTA keys already exist. Do not rotate an installed app’s trust key.');
    mkdirSync(resolve(keyPath, '..'), { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(
      trustPath,
      JSON.stringify(
        {
          runtime: '2.0.0',
          publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
          nativeFingerprint: nativeFingerprint(root),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      `OTA trust initialized. Private key: ${keyPath}. Back it up securely; never commit it.`,
    );
    return;
  }
  const trust = JSON.parse(readFileSync(trustPath, 'utf8'));
  if (command === 'runtime') {
    const runtime = values.runtime;
    const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
    if (
      !runtime ||
      !/^\d+\.\d+\.\d+$/.test(runtime) ||
      runtime === trust.runtime ||
      !gradle.includes(`versionName "${runtime}"`)
    ) {
      throw new Error(
        'First bump Android versionCode and versionName, then pass the new --runtime X.Y.Z',
      );
    }
    trust.runtime = runtime;
    trust.nativeFingerprint = nativeFingerprint(root);
    writeFileSync(trustPath, JSON.stringify(trust, null, 2) + '\n');
    console.log('New runtime recorded. Ship a new APK before publishing updates for this runtime.');
    return;
  }
  if (nativeFingerprint(root) !== trust.nativeFingerprint) {
    throw new Error(
      'Native Android files or plugins changed. A new APK/runtime is required; see docs/LIVE_UPDATES.md.',
    );
  }
  if (command !== 'publish')
    throw new Error('Usage: npm run ota:init OR npm run ota:publish -- --key PATH --output DIR');
  const privateKey = readFileSync(keyPath, 'utf8');
  if (
    createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64') !==
    trust.publicKey
  ) {
    throw new Error('Signing key does not match the public key in the app');
  }
  const output = resolve(values.output, trust.runtime);
  mkdirSync(output, { recursive: true });
  chmodSync(output, 0o755);
  const lock = join(output, '.publish-lock');
  mkdirSync(lock); // Fail on concurrent publishers. Remove a stale lock only after verifying no publisher is running.
  try {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'run',
      'build',
      '--',
      '--configuration',
      'production',
    ]);
    const webDir = join(root, 'dist/eat_it_ng/browser');
    if (!existsSync(join(webDir, 'index.html'))) throw new Error('Missing built index.html');
    const assertFiles = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error('Symlinks cannot be published');
        if (stat.isDirectory()) assertFiles(path);
      }
    };
    assertFiles(webDir);
    const sequence = Date.now();
    const version = `${trust.runtime.split('.')[0]}.${Math.floor(sequence / 1_000_000_000)}.${sequence % 1_000_000_000}`;
    const zipPath = join(lock, 'bundle.zip');
    run('zip', ['-qr', zipPath, '.', '-x', '*.map', '*.DS_Store'], webDir);
    const bytes = readFileSync(zipPath);
    if (bytes.length > 50 * 1024 * 1024) throw new Error('OTA package exceeds 50 MB');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = `${version}-${sha256}.zip`;
    const payload = {
      schema: 1,
      runtime: trust.runtime,
      version,
      sequence,
      nativeFingerprint: trust.nativeFingerprint,
      sha256,
      bytes: bytes.length,
    };
    renameSync(zipPath, join(output, filename));
    chmodSync(join(output, filename), 0o644);
    const pending = join(lock, 'latest.json');
    writeFileSync(pending, JSON.stringify(signManifest(payload, privateKey)) + '\n');
    chmodSync(pending, 0o644);
    renameSync(pending, join(output, 'latest.json'));
    console.log(`Published signed update ${version} to ${output}`);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
