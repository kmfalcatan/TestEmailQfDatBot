// Launch Puppeteer
const browser = await puppeteer.launch({
  args: chromium.args,
  defaultViewport: chromium.defaultViewport,
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();

console.log('🚀 Navigating to QuoteFactory...');
await page.goto('https://app.quotefactory.com', { waitUntil: 'networkidle2', timeout: 60000 });

// 🧩 STEP 2 — Login to QuoteFactory
console.log('🔐 Logging in...');
await page.type('input[name="email"]', process.env.QUOTEFACTORY_USERNAME, { delay: 100 });
await page.type('input[name="password"]', process.env.QUOTEFACTORY_PASSWORD, { delay: 100 });
await page.click('button[type="submit"]');
await page.waitForNavigation({ waitUntil: 'networkidle2' });
console.log('✅ Logged into QuoteFactory');

// ✅ Continue to your next step (Step 3 — navigate to load page)
const loadRef = loadReference;
await page.goto(`https://app.quotefactory.com/load/${loadRef}`, {
  waitUntil: 'networkidle2',
  timeout: 60000,
});
console.log(`📦 Viewing load ${loadRef}`);
