// @ts-check
import { test, expect } from '@playwright/test';
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('bidirectional messaging', async ({ browser }) => {
  // Kill any existing server on test port
  try { execSync('lsof -ti:9877 | xargs kill -9 2>/dev/null', { stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 500));

  // Start fresh server on unique port (avoid conflicts with user's open tabs on 3001)
  const server = spawn('node', ['src/index.js'], {
    cwd: join(__dirname, '..', 'server'),
    env: { ...process.env, PORT: '9877' },
  });
  const serverLogs = [];
  server.stdout.on('data', d => { const l = d.toString().trim(); serverLogs.push(l); console.log(`[SERVER] ${l}`); });
  server.stderr.on('data', d => { const l = d.toString().trim(); serverLogs.push(l); console.log(`[SERVER ERR] ${l}`); });

  // Wait for server to start
  await new Promise(r => setTimeout(r, 1000));

  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  // Inject signaling URL before any JS runs
  await pageA.addInitScript(() => { (window as any).__SIGNALING_URL__ = 'ws://localhost:9877'; });
  await pageB.addInitScript(() => { (window as any).__SIGNALING_URL__ = 'ws://localhost:9877'; });

  const consoleA: string[] = [];
  const consoleB: string[] = [];
  pageA.on('console', msg => { const t = msg.text(); consoleA.push(t); console.log(`[A] ${t}`); });
  pageB.on('console', msg => { const t = msg.text(); consoleB.push(t); console.log(`[B] ${t}`); });

  await pageA.goto('http://localhost:5173');
  await pageB.goto('http://localhost:5173');

  await pageA.waitForSelector('.status-dot.online', { timeout: 10000 });
  await pageB.waitForSelector('.status-dot.online', { timeout: 10000 });

  // Wait for exactly 2 devices in the list (filter out stale connections)
  await pageA.waitForFunction(() => document.querySelectorAll('.device-list .device-item').length >= 1, { timeout: 10000 });
  await pageB.waitForFunction(() => document.querySelectorAll('.device-list .device-item').length >= 1, { timeout: 10000 });

  // Wait a moment for any stale reconnects to settle
  await pageA.waitForTimeout(2000);

  // Click on the FIRST device in the list
  await pageA.locator('.device-list .device-item').first().click();
  await pageA.waitForSelector('.peer-status.connected', { timeout: 15000 });
  console.log('A -> B connected');

  // A sends message
  await pageA.locator('.input-area input[type="text"]').fill('Hello from A');
  await pageA.locator('.input-area button').first().click();
  await pageA.waitForTimeout(1000);

  // B clicks on the device at top of list
  await pageB.locator('.device-list .device-item').first().click();
  await pageB.waitForTimeout(500);

  // Wait for B to show chat panel
  await pageB.waitForSelector('.chat-section', { timeout: 5000 });
  console.log('B chat panel opened');

  // Check B's peer status before sending
  const bPeerStatus = await pageB.locator('.peer-status').textContent().catch(() => 'unknown');
  console.log(`B peer status before send: ${bPeerStatus}`);

  // B sends message
  const bInput = pageB.locator('.input-area input[type="text"]').first();
  const bButton = pageB.locator('.input-area button').first();
  await bInput.fill('Hello from B');
  await bButton.click();
  await pageB.waitForTimeout(2000);

  // Check what messages each page sees
  const aBubbles = await pageA.locator('.bubble').allInnerTexts().catch(() => []);
  const bBubbles = await pageB.locator('.bubble').allInnerTexts().catch(() => []);
  console.log('A bubbles:', aBubbles);
  console.log('B bubbles:', bBubbles);

  const aGotB = aBubbles.some(t => t.includes('Hello from B'));
  const bGotA = bBubbles.some(t => t.includes('Hello from A'));
  console.log(`B received A's message: ${bGotA}`);
  console.log(`A received B's message: ${aGotB}`);

  server.kill();

  expect(bGotA).toBe(true);
  expect(aGotB).toBe(true);
});
