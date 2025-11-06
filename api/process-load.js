// api/process-load.js - Separate endpoint for detailed load processing
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await page.evaluate(e => getComputedStyle(e).display !== 'none', el)) {
        return sel;
      }
    } catch {}
  }
  return null;
}

async function isLoggedIn(page) {
  if (page.url().includes('auth.quotefactory.com')) return false;
  if (page.url().includes('app.quotefactory.com')) {
    await wait(2000);
    return page.evaluate(() => !!(
      document.querySelector('nav, header, button') || 
      document.body.textContent.includes('find')
    ));
  }
  return false;
}

class QuoteFactoryBot {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    console.log('🚀 Launching browser...');
    
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ];

    const launchOptions = process.env.CHROME_BIN
      ? { headless: true, args: baseArgs, executablePath: process.env.CHROME_BIN }
      : {
          args: [...chromium.args, ...baseArgs],
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
        };

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  }

  async login() {
    console.log('🔐 Logging in...');
    const username = process.env.QUOTEFACTORY_USERNAME;
    const password = process.env.QUOTEFACTORY_PASSWORD;
    if (!username || !password) throw new Error('Missing credentials');

    try {
      await this.page.goto('https://app.quotefactory.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
    } catch {}
    
    await wait(5000);

    if (await isLoggedIn(this.page)) {
      console.log('✅ Already logged in');
      return true;
    }

    try {
      await this.page.waitForSelector('.auth0-lock-widget', { timeout: 3000 });
      await wait(2000);
    } catch {
      await this.page.waitForFunction(
        () => document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2,
        { timeout: 10000 }
      );
    }

    const emailSel = await findVisible(this.page, ['input[type="email"]', 'input[name="email"]', 'input[name="username"]']);
    if (!emailSel) throw new Error('Email field not found');
    
    await this.page.click(emailSel, { clickCount: 3 });
    await wait(300);
    await this.page.type(emailSel, username, { delay: 50 });
    await wait(800);

    const passSel = await findVisible(this.page, ['input[type="password"]', 'input[name="password"]']);
    if (!passSel) throw new Error('Password field not found');
    
    await this.page.click(passSel, { clickCount: 3 });
    await wait(300);
    await this.page.type(passSel, password, { delay: 50 });
    await wait(800);

    let submitSel = await findVisible(this.page, ['button[type="submit"]', 'button[name="submit"]', '.auth0-lock-submit']);
    if (!submitSel) {
      submitSel = await this.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /log in|sign in|continue/i.test(b.textContent));
        if (btn) { btn.setAttribute('data-submit', '1'); return '[data-submit="1"]'; }
        return null;
      });
    }
    if (!submitSel) throw new Error('Submit button not found');

    await this.page.click(submitSel);
    try { await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }); } catch {}
    await wait(3000);

    const success = await isLoggedIn(this.page);
    console.log(success ? '✅ Login successful' : '❌ Login failed');
    return success;
  }

  async searchLoad(loadRef) {
    console.log(`🔍 Searching: ${loadRef}`);
    
    try {
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyK');
      await this.page.keyboard.up('Control');
      await wait(1500);

      try {
        await this.page.waitForSelector('#search_field', { timeout: 5000 });
      } catch {
        await this.page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => /find|anything/i.test(b.textContent));
          if (btn) btn.click();
        });
        await wait(1500);
        await this.page.waitForSelector('#search_field', { timeout: 5000 });
      }

      await this.page.click('#search_field', { clickCount: 3 });
      await this.page.type('#search_field', loadRef, { delay: 80 });
      await this.page.keyboard.press('Enter');
      await wait(5000);

      await this.page.evaluate(() => {
        ['.\\@container a[data-current="true"]', '.\\@container a', '.\\@container'].some(sel => {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
        });
      });
      await wait(4000);

      const result = await this.page.evaluate(() => {
        const text = document.body.innerText;
        const bolMatch = text.match(/BOL[\s\n]+(\d+)/i);
        const loadReference = bolMatch ? bolMatch[1] : "N/A";
        
        let rate = "N/A";
        const priceDiv = document.querySelector('.text-right.py-2.font-bold.order-last.px-3');
        if (priceDiv) {
          const m = priceDiv.textContent.match(/\$[\d,]+\.?\d*/);
          if (m) rate = m[0];
        }
        
        let weight = "N/A";
        const weightDiv = Array.from(document.querySelectorAll("div")).find(d => d.textContent.trim() === "Weight");
        if (weightDiv) {
          const val = weightDiv.closest(".flex")?.querySelector("div.font-semibold, .text-12, .text-15");
          if (val) {
            const txt = val.textContent.replace(/\u202F/g, "").trim();
            weight = txt.match(/lb/i) ? txt : `${txt} lb`;
          }
        }
        
        let commodity = "N/A";
        const commDiv = Array.from(document.querySelectorAll("div.text-black-100.text-12.pt-1.flex.items-baseline")).find(d => d.querySelector("div.font-semibold"));
        if (commDiv) {
          const strong = commDiv.querySelector("div.font-semibold")?.textContent.trim() || "";
          commodity = strong.replace(/&nbsp;/g, '').trim();
        }
        
        function toMilitaryNoColon(timeStr) {
          const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
          if (!match) return timeStr.replace(/:/g, '').trim();
          let [_, hour, minute, period] = match;
          hour = parseInt(hour, 10);
          if (period) {
            period = period.toLowerCase();
            if (period === 'pm' && hour !== 12) hour += 12;
            if (period === 'am' && hour === 12) hour = 0;
          }
          return `${String(hour).padStart(2, '0')}${minute}`;
        }

        const locs = Array.from(document.querySelectorAll('[id^="shipment-location-"]'));
        const pickups = [], deliveries = [];
        let foundPickup = false;

        locs.forEach(loc => {
          const addr = loc.querySelector('address');
          if (!addr) return;

          const lines = Array.from(addr.querySelectorAll('div')).map(d => d.textContent.trim()).filter(Boolean);
          let cityState = lines.length > 1 ? lines[lines.length - 1].replace(/\s*\d{5}(?:-\d{4})?/, "").trim() : "";

          const timeContainer = Array.from(loc.querySelectorAll('div.text-14')).find(container => container.querySelector('time'));
          let dateTime = "N/A";

          if (timeContainer) {
            const times = timeContainer.querySelectorAll('time');
            if (times.length >= 2) {
              const startTime = toMilitaryNoColon(times[0].textContent.trim());
              const endTime = toMilitaryNoColon(times[1].textContent.trim());
              const datetimeAttr = times[0].getAttribute('datetime');
              if (datetimeAttr) {
                const d = new Date(datetimeAttr);
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateTime = `${mo}/${day} ${startTime}-${endTime}`;
              } else dateTime = `${startTime}-${endTime}`;
            } else if (times.length === 1) {
              const time = toMilitaryNoColon(times[0].textContent.trim());
              const datetimeAttr = times[0].getAttribute('datetime');
              if (datetimeAttr) {
                const d = new Date(datetimeAttr);
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateTime = `${mo}/${day} ${time}`;
              } else dateTime = `${time}`;
            }
          }

          const txt = loc.textContent.toLowerCase();
          const isPickup = txt.includes('PICK UP') || (txt.includes('PICKED UP') && !txt.includes('DELIVER'));
          const isDelivery = txt.includes('DELIVER');

          let finalPickup = isPickup, finalDelivery = isDelivery;
          if (!finalPickup && !finalDelivery) {
            if (!foundPickup) finalPickup = true;
            else finalDelivery = true;
          }

          if (finalPickup) {
            foundPickup = true;
            pickups.push(`${cityState}, ${dateTime}`);
          } else if (finalDelivery) {
            deliveries.push(`${cityState}, ${dateTime}`);
          }
        });

        const pickup = pickups.length ? pickups.map((p, i) => `Pickup ${i + 1}: ${p}`).join("\n") : "N/A";
        const delivery = deliveries.length ? deliveries.map((d, i) => `Delivery ${i + 1}: ${d}`).join("\n") : "N/A";

        return { loadReference, rate, weight, commodity, pickup, delivery };
      });

      console.log('✅ Data extracted:', result);
      const hasCompleteData = result.loadReference !== "N/A" && result.pickup !== "N/A" && result.delivery !== "N/A";
      return hasCompleteData ? result : null;
      
    } catch (err) {
      console.log('⚠️  Search error:', err.message);
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

// Main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { loadRef } = req.body;
  
  if (!loadRef) {
    return res.status(400).json({ error: 'loadRef required' });
  }

  console.log(`=== Processing Load ${loadRef} ===`);
  const startTime = Date.now();

  const bot = new QuoteFactoryBot();
  let data = null;

  try {
    await bot.init();
    const loggedIn = await bot.login();
    
    if (loggedIn) {
      data = await bot.searchLoad(loadRef);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await bot.close();
  }

  const totalTime = Date.now() - startTime;
  console.log(`⏱️  Total time: ${totalTime}ms`);

  if (data) {
    return res.json({
      success: true,
      data,
      responseSubject: `Re: Load Inquiry - ${loadRef} - Complete Details`,
      responseBody: `Hello,

Thank you for your inquiry about load ${loadRef}. Here are the details:

📦 LOAD DETAILS:
${data.pickup}
${data.delivery}
Weight: ${data.weight}
Commodity: ${data.commodity}
Rate: ${data.rate}

🚛 CAPACITY INQUIRY:
When and where will you be empty for pickup?

Best regards,
Balto Booking

---
Automated response with live QuoteFactory data`,
      executionTime: totalTime,
      timestamp: new Date().toISOString()
    });
  } else {
    return res.json({
      success: false,
      data: null,
      message: 'Load not found in QuoteFactory',
      executionTime: totalTime,
      timestamp: new Date().toISOString()
    });
  }
}

export const config = { maxDuration: 60 };