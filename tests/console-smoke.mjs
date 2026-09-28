// Optional browser smoke test. Uses only in-memory mock data; never contacts CloudKit.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const files = new Set(['index.html','app.js','icons.js','styles.css','theme-init.js']);
const server = createServer(async (req,res) => {
  const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
  if (name === 'config.js') { res.setHeader('Content-Type','application/javascript'); res.end("const CLOUDKIT_CONFIG={apiToken:''}; const TAG_REQUEST_EMAIL='test@example.com';"); return; }
  if (!files.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(new URL('../'+name,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
try {
  const page=await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Sign in with Apple',exact:true}).click();
  await page.getByRole('button',{name:'Add Venue',exact:true}).click();
  await page.locator('#venue-form-name').fill('Regression Museum');
  await page.locator('#venue-form-address').fill('123 Main St');
  await page.locator('#venue-form-save').click();
  assert.match(await page.locator('#venue-form-error').innerText(),/valid latitude/);
  await page.locator('#venue-latitude').fill('43.1566');
  await page.locator('#venue-longitude').fill('-77.6088');
  await page.locator('#venue-form-save').click();
  await page.getByText('Regression Museum',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(async()=> (await Store.allVenues()).find(v=>v.name==='Regression Museum').location), {latitude:43.1566,longitude:-77.6088});
  await page.locator('#nav-hunts-home').click();
  await page.getByText('Dinosaur Trail',{exact:true}).click();
  await page.locator('#input-hunt-title').fill('Updated Dinosaur Trail');
  await page.locator('#btn-save-hunt').click();
  await page.locator('#hunts-home-list').getByText('Updated Dinosaur Trail',{exact:true}).waitFor();
  await page.locator('#nav-stats').click();
  await page.locator('.stat-tile-label').getByText('Completion Rate',{exact:true}).waitFor();
  await page.locator('#nav-giftshop').click();
  await page.locator('#giftshop-code-input').fill('DEMOX');
  await page.locator('#giftshop-redeem-btn').click();
  await page.locator('.giftshop-redeem-success').waitFor();
  await page.locator('#nav-settings').click();
  await page.getByRole('button',{name:'Dark',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);
  console.log('PASS: console sign-in, coordinate validation, venue creation, hunt editing, statistics, redemption, theme; no browser errors');
} finally { await browser.close(); server.close(); }
