import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, cpSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const platform = process.argv[2] || ({ darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]);
if (!['mac', 'win', 'linux'].includes(platform)) throw Error('Choose mac, win or linux.');
if (platform !== ({ darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform])) throw Error('Build native installers on the matching operating system (use the CI workflow).');
const index = process.argv.indexOf('--arch'); const arch = index < 0 ? process.arch : process.argv[index + 1];
if (!['arm64', 'x64'].includes(arch)) throw Error('Choose arm64 or x64.');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
if (platform === 'mac') {
  const scratch = path.join(root, '.packaging', 'swift-' + arch), packagePath = path.join(root, 'tools/grupetto-wifi-harness');
  const args = ['build', '--package-path', packagePath, '--scratch-path', scratch, '-c', 'release', '--arch', arch === 'x64' ? 'x86_64' : 'arm64'];
  run('swift', args);
  const bin = execFileSync('swift', [...args, '--show-bin-path'], { cwd: root, encoding: 'utf8' }).trim();
  const bundle = path.join(root, '.packaging/helper/Grupetto Bridge.app');
  mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
  copyFileSync(path.join(bin, 'GrupettoWiFi'), path.join(bundle, 'Contents/MacOS/GrupettoWiFi'));
  let plist = readFileSync(path.join(packagePath, 'Info.plist'), 'utf8').replace('local.pelotonicreaction.grupetto-wifi-test', 'com.pelotonicreaction.grupetto-bridge').replace('Grupetto WiFi Test', 'Grupetto Bridge');
  writeFileSync(path.join(bundle, 'Contents/Info.plist'), plist);
  run('xattr', ['-cr', bundle]); run('codesign', ['--force', '--sign', '-', bundle]);
}
const builder = path.join(root, 'node_modules/electron-builder/cli.js');
// electron-builder rejects shell-special characters in output paths. Keep the
// native tools in an isolated safe directory even when the checkout is in iCloud.
const staging=mkdtempSync(path.join(os.tmpdir(),'pelotonic-build-'));
const project=path.join(staging,'project'),output=path.join(staging,'artifacts');
try {
  mkdirSync(project,{recursive:true});
  // pkg XML also embeds resource paths, so stage both input and output paths.
  for(const name of ['desktop','lib','public','workouts','server.mjs','package.json','package-lock.json','.env.example','README.md','packaging'])cpSync(path.join(root,name),path.join(project,name),{recursive:true});
  if(platform==='mac')cpSync(path.join(root,'.packaging/helper'),path.join(project,'.packaging/helper'),{recursive:true});
  symlinkSync(path.join(root,'node_modules'),path.join(project,'node_modules'),process.platform==='win32'?'junction':'dir');
  execFileSync(process.execPath,[builder,'--projectDir',project,'--config','packaging/electron-builder.cjs','--config.directories.output='+output,'--'+platform,'--'+arch,...(process.argv.includes('--dir')?['--dir']:[]),'--publish','never'],{cwd:project,stdio:'inherit'});
  function verify(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(platform==='mac'&&entry.name.endsWith('.app'))run('codesign',['--verify','--deep','--strict',file]);verify(file);}else if(entry.name==='app.asar')run(process.execPath,[path.join(root,'scripts/verify-package.mjs'),file]);}}
  verify(output);
  const destination=path.join(root,'dist');mkdirSync(destination,{recursive:true});
  const artifacts=readdirSync(output).filter(name=>/\.(pkg|msi|deb|rpm)$/.test(name));
  if(process.argv.includes('--dir'))cpSync(output,path.join(destination,'unpacked'),{recursive:true,verbatimSymlinks:true});
  else if(!artifacts.length)throw Error('No native installer was produced.');
  for(const name of artifacts){
    cpSync(path.join(output,name),path.join(destination,name));
    const digest=createHash('sha256').update(readFileSync(path.join(destination,name))).digest('hex');
    writeFileSync(path.join(destination,name+'.sha256'),`${digest}  ${name}\n`);
  }
  console.log('Installer artifacts are in '+path.join(root,'dist'));
} finally {rmSync(staging,{recursive:true,force:true});}
