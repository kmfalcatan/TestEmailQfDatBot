// api/webhook.js
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------
// Puppeteer automation class
// -----------------------------
class QuoteFactoryBot {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    console.log('🚀 Launching Puppeteer...');
    const launchOptions = process.env.CHROME_BIN
      ? { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], executablePath: process.env.CHROME_BIN }
      : {
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
        };

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }

  async isLoggedIn() {
    const url = this.page.url();
    if (url.includes('auth.quotefactory.com')) return false;
    if (url.includes('app.quotefactory.com')) {
      await wait(2000);
      return this.page.evaluate(() => !!document.querySelector('nav, header, button'));
    }
    return false;
  }

  async login() {
    console.log('🔐 Logging into QuoteFactory...');
    const username = process.env.QUOTEFACTORY_USERNAME;
    const password = process.env.QUOTEFACTORY_PASSWORD;
    if (!username || !password) throw new Error('Missing credentials');

    await this.page.goto('https://app.quotefactory.com', { waitUntil: 'networkidle2', timeout: 60000 });
    await wait(5000);
    if (await this.isLoggedIn()) return true;

    await this.page.waitForFunction(
      () => document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2,
      { timeout: 30000 }
    );

    await this.page.type('input[type="email"]', username, { delay: 100 });
    await wait(500);
    await this.page.type('input[type="password"]', password, { delay: 100 });
    await wait(500);

    const btn = await this.page.$('button[type="submit"], .auth0-lock-submit');
    if (btn) await btn.click();
    await wait(8000);

    const success = await this.isLoggedIn();
    console.log(success ? '✅ Login successful' : '❌ Login failed');
    return success;
  }

  async searchLoad(loadRef) {
    console.log(`🔍 Searching for load reference: ${loadRef}`);
    try {
      // Open search box (Ctrl + K shortcut)
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyK');
      await this.page.keyboard.up('Control');
      await wait(2000);

      await this.page.waitForSelector('#search_field', { timeout: 8000 });
      await this.page.click('#search_field', { clickCount: 3 });
      await this.page.type('#search_field', loadRef, { delay: 100 });
      await this.page.keyboard.press('Enter');
      await wait(8000);

      // Extract results
      const result = await this.page.evaluate(() => {
        const txt = document.body.innerText;
        const matchRate = txt.match(/\$\s?[\d,]+/);
        const matchWeight = txt.match(/[\d,]+\s?(?:lb|lbs|pounds)/i);
        const locs = Array.from(document.querySelectorAll('address')).map((a) => a.textContent.trim());
        return {
          rate: matchRate ? matchRate[0] : 'N/A',
          weight: matchWeight ? matchWeight[0] : 'N/A',
          pickup: locs[0] || 'Pickup TBD',
          delivery: locs[1] || 'Delivery TBD',
        };
      });

      console.log('✅ Load data found:', result);
      return result;
    } catch (err) {
      console.log('⚠️ Load search failed:', err.message);
      return null;
    }
  }

  async close() {
    try {
      if (this.page) await this.page.close();
      if (this.browser) await this.browser.close();
    } catch {}
  }
}

// -----------------------------
// Email formatting helpers
// -----------------------------
function formatEmail(ref, data) {
  if (data) {
    return {
      subject: `Re: Load Inquiry - ${ref}`,
      body: `Hello,

Thank you for your inquiry about load ${ref}. Here are the details:

📦 LOAD DETAILS:
Pickup: ${data.pickup}
Delivery: ${data.delivery}
Weight: ${data.weight}
Rate: ${data.rate}

🚛 CAPACITY INQUIRY:
When and where will you be empty for pickup?

Best regards,
Balto Booking

---
Automated response with live QuoteFactory data`,
    };
  }
  return {
    subject: `Re: Load Inquiry - ${ref}`,
    body: `Hello,

Thank you for your inquiry regarding load ${ref}.

I've identified this load reference and am currently pulling the complete details from our system.
You'll receive complete information shortly.

Best regards,
Balto Booking

---
Professional freight services with real-time load tracking`,
  };
}

function extractLoadRef(emailBody = '') {
  const patterns = [
    /order\s*#?\s*(\d{5,8})/i,
    /reference\s+number\s+(\d{5,8})/i,
    /ref[:\s]+(\d{5,8})/i,
    /\b(\d{5,8})\b/i,
    /(?:load\s*(?:ref|reference|number|id|#)[:\-\s]*)([A-Z0-9\-\_]+)/i,
  ];
  for (const p of patterns) {
    const m = emailBody.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// -----------------------------
// Webhook handler for Zapier
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const emailBody = req.body.bodyPreview || req.body.body?.content || '';
  const subject = req.body.subject || 'Load Inquiry';
  const loadRef = extractLoadRef(emailBody);

  if (!loadRef) {
    return res.json({
      success: true,
      responseSubject: `Re: ${subject} - DAT Reference Needed`,
      responseBody:
        'Hello,\n\nPlease provide the DAT or QuoteFactory load reference number to retrieve details.\n\nThanks,\nBalto Booking',
    });
  }

  const bot = new QuoteFactoryBot();
  let data = null;

  try {
    await bot.init();
    const loggedIn = await bot.login();
    if (loggedIn) {
      data = await bot.searchLoad(loadRef);
    } else {
      console.log('❌ Login failed, skipping search.');
    }
  } catch (err) {
    console.error('❌ Puppeteer error:', err.message);
  } finally {
    await bot.close();
  }

  const { subject: replySub, body: replyBody } = formatEmail(loadRef, data);
  res.json({
    success: true,
    loadRef,
    data: data || null,
    responseSubject: replySub,
    responseBody: replyBody,
    timestamp: new Date().toISOString(),
  });
}

// Required for Vercel’s function timeout limit
export const config = { maxDuration: 30 };
