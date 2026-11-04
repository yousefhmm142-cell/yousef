const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const A = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  A.on('pageerror', e => console.log('pageerror', e.message)); A.on('console', m => m.type()==='error' && console.log('console', m.text().slice(0,200)));
  await A.goto('http://localhost:5199/login'); await A.locator('#phone').fill('0599000001'); await A.locator('#pin').fill('112233'); await A.waitForTimeout(4000);
  await A.goto('http://localhost:5199/tasks'); await A.waitForTimeout(4000);
  const b64 = await A.evaluate(async () => { const m = await import('/src/lib/sheetPdf.ts'); const el = document.querySelector('.print-sheet'); const blob = await m.sheetToPdf(el); const buf = new Uint8Array(await blob.arrayBuffer()); let s=''; for (let i=0;i<buf.length;i+=0x8000) s+=String.fromCharCode(...buf.subarray(i,i+0x8000)); return btoa(s) });
  fs.writeFileSync('/tmp/m2-work/test.pdf', Buffer.from(b64, 'base64')); console.log('pdf bytes', Buffer.from(b64,'base64').length); await b.close();
})().catch(e => { console.log('FAILED', e.message); process.exit(1) });
