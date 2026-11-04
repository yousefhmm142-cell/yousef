const { chromium } = require('playwright');
const BASE = 'http://localhost:4175';
const sql = (q) => require('child_process').execSync(`docker compose -f /home/user/yousef/mukhayyam-2/supabase/local/docker-compose.yml exec -T db psql -U postgres -d postgres -Atc ${JSON.stringify(q)}`).toString().trim();
(async () => {
  sql(`update seals set status='used', used_on=current_date, details='طبلون 7 تفتيش + فك ساعة نوح كلاب', board_no='7' where seal_no=181303`);
  sql(`update seals set status='used', used_on=current_date, details='طبلون 8 صيانة (علي)', board_no='8' where seal_no=181304`);
  const b = await chromium.launch(); const A = await (await b.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  const errs=[]; A.on('pageerror', e => errs.push(e.message));
  await A.goto(BASE + '/login');
  await A.locator('#phone').fill('0599000001'); await A.locator('#pin').fill('112233');
  await A.waitForTimeout(4000);
  await A.goto(BASE + '/tasks'); await A.waitForTimeout(3500);
  console.log('KPI texts:', (await A.locator('.kpi').allInnerTexts()).map(t=>t.replace(/\s+/g,' ')).join(' || '));
  console.log('daily sheet:', (await A.locator('section.card').last().innerText()).replace(/\s+/g,' ').slice(0,300));
  await A.screenshot({ path: '/tmp/m2-work/tk.png', fullPage: true });
  console.log(errs.join('\n')||'no errors'); await b.close();
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1) });
