import puppeteer from 'puppeteer-core';

(async () => {
  try {
    console.log('🚀 Launching browser...');
    
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    await page.goto('https://app.quotefactory.com', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('✅ Page loaded:', page.url());

    await browser.close();
    console.log('✅ Browser closed successfully');
  } catch (err) {
    console.error('❌ Puppeteer test failed:', err);
  }
})();
