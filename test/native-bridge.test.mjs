import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
const executable = path.resolve('tools/grupetto-wifi-harness/dist/Grupetto WiFi Test.app/Contents/MacOS/GrupettoWiFi');
test('native bridge runs headlessly, accepts commands, and exits on parent EOF', { skip: process.platform !== 'darwin' || !existsSync(executable), timeout: 10000 }, async t => {
  const child = spawn(executable, ['--bridge'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const snapshots = [];
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject);
    lines.on('line', line => {
      try { const snapshot = JSON.parse(line); snapshots.push(snapshot); if (snapshot.averagingSeconds === 7) resolve(); } catch (error) { reject(error); }
    });
  });
  child.stdin.write(JSON.stringify({ action: 'average', seconds: 7 }) + '\n');
  await ready;
  assert.equal(snapshots.at(-1).connected, false);
  assert.deepEqual(snapshots.at(-1).metrics, {});
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end();
  assert.equal(await exit, 0);
  lines.close();
});
