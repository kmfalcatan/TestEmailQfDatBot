import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export async function fetchLoadInfo(loadReference = '289926') {
  console.log(`🔍 Starting QuoteFactory lookup for load: ${loadReference}`);

  let browser;
  let page;

  try {
    // Launch Puppeteer with Sparticuz Chromium (works on Vercel)
    const launchOptions = process.env.CHROME_BIN
      ? { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      : {
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
          ignoreHTTPSErrors: true,
          // ✅ persist login across runs if you want
          userDataDir: './chromium-data',
        };

    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Go to QuoteFactory dashboard (must already be logged in)
    await page.goto('https://app.quotefactory.com/broker/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Verify login
    const currentUrl = page.url();
    if (currentUrl.includes('auth.quotefactory.com')) {
      throw new Error('❌ Not logged in — please log in manually first');
    }

    console.log('✅ On dashboard — proceeding with load search');

    // Focus search box ("/" is the shortcut key)
    await page.keyboard.press('/');
    await new Promise((r) => setTimeout(r, 1500));

    // Type the load reference
    await page.keyboard.type(loadReference, { delay: 80 });
    await new Promise((r) => setTimeout(r, 2500));

    // Try to click the matching load
    const [result] = await page.$x(`//*[contains(text(), '${loadReference}')]`);
    if (result) {
      await result.click();
      console.log('✅ Clicked matching load result');
    } else {
      console.log('⚠️ No clickable result found — pressing Enter');
      await page.keyboard.press('Enter');
    }

    // Wait for load details to render
    await new Promise((r) => setTimeout(r, 6000));

    // Extract info from page text
    const loadData = await page.evaluate(() => {
      const text = document.body.innerText;

      const pickupMatch = text.match(/Pickup[:\s]+([\w\s,]+[A-Z]{2})/i);
      const deliveryMatch = text.match(/Delivery[:\s]+([\w\s,]+[A-Z]{2})/i);
      const weightMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*(lbs?|pounds?)/i);
      const rateMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);

      return {
        pickup: pickupMatch ? pickupMatch[1].trim() : null,
        delivery: deliveryMatch ? deliveryMatch[1].trim() : null,
        weight: weightMatch ? weightMatch[0].trim() : null,
        rate: rateMatch ? rateMatch[0].trim() : null,
      };
    });

    console.log('📦 Extracted load data:', loadData);

    // Return formatted result (same as your webhook output)
    return {
      loadReference,
      pickup: loadData.pickup || 'Pickup TBD',
      delivery: loadData.delivery || 'Delivery TBD',
      weight: loadData.weight || 'Weight TBD',
      rate: loadData.rate || 'Rate TBD',
    };
  } catch (error) {
    console.error('❌ Load fetch error:', error.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Run standalone test
if (process.argv[1].includes('loadFetcher')) {
  fetchLoadInfo('289926').then((info) => console.log('✅ Final result:', info));
}
