// testPuppeteer.js - Minimized version
import "dotenv/config";
import fs from "fs/promises";
import puppeteer from "puppeteer";

const CONFIG = {
  COOKIES_PATH: "./cookies.json",
  DASHBOARD_URL: "https://app.quotefactory.com/broker/dashboard",
  USERNAME: process.env.QF_USERNAME,
  PASSWORD: process.env.QF_PASSWORD,
  FOLLOW_UP_DELAY: 5000,
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await page.evaluate(e => getComputedStyle(e).display !== 'none', el)) return sel;
    } catch {}
  }
  return null;
}

async function loadCookies() {
  try { return JSON.parse(await fs.readFile(CONFIG.COOKIES_PATH, "utf8")); } catch { return null; }
}

async function saveCookies(page) {
  await fs.writeFile(CONFIG.COOKIES_PATH, JSON.stringify(await page.cookies(), null, 2));
}

async function isLoggedIn(page) {
  if (page.url().includes('auth.quotefactory.com')) return false;
  if (page.url().includes('app.quotefactory.com')) {
    await wait(2000);
    return page.evaluate(() => !!(document.querySelector('nav, header, button') || document.body.textContent.includes('find')));
  }
  return false;
}

async function login(page) {
  try { await page.goto('https://app.quotefactory.com', { waitUntil: "networkidle2", timeout: 90000 }); } catch {}
  await wait(8000);
  if (await isLoggedIn(page)) return true;

  try {
    await page.waitForSelector('.auth0-lock-widget', { timeout: 10000 });
    await wait(5000);
  } catch {
    await page.waitForFunction(() => document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2, { timeout: 60000 });
  }

  const emailSel = await findVisible(page, ['input[type="email"]', 'input[name="email"]', 'input[name="username"]']);
  if (!emailSel) throw new Error("Email input not found");
  await page.click(emailSel, { clickCount: 3 });
  await wait(500);
  await page.type(emailSel, CONFIG.USERNAME, { delay: 100 });
  await wait(1500);

  const passSel = await findVisible(page, ['input[type="password"]', 'input[name="password"]']);
  if (!passSel) throw new Error("Password input not found");
  await page.click(passSel, { clickCount: 3 });
  await wait(500);
  await page.type(passSel, CONFIG.PASSWORD, { delay: 100 });
  await wait(1500);

  let submitSel = await findVisible(page, ['button[type="submit"]', 'button[name="submit"]', '.auth0-lock-submit']);
  if (!submitSel) {
    submitSel = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /log in|sign in|continue/i.test(b.textContent));
      if (btn) { btn.setAttribute('data-submit', '1'); return '[data-submit="1"]'; }
      return null;
    });
  }
  if (!submitSel) throw new Error("Submit button not found");

  await page.click(submitSel);
  try { await page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle2' }); } catch {}
  await wait(5000);
  
  const loggedIn = await isLoggedIn(page);
  if (loggedIn) await saveCookies(page);
  return loggedIn;
}

async function searchLoad(page, ref) {
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await wait(2000);

  try {
    await page.waitForSelector('#search_field', { timeout: 5000 });
  } catch {
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => /find|anything/i.test(b.textContent))?.click());
    await wait(2000);
    await page.waitForSelector('#search_field', { timeout: 5000 });
  }

  await page.click('#search_field', { clickCount: 3 });
  await page.type('#search_field', ref, { delay: 100 });
  await page.keyboard.press('Enter');
  await wait(8000);

  await page.evaluate(() => {
    ['.\\@container a[data-current="true"]', '.\\@container a', '.\\@container'].some(sel => {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    });
  });
  await wait(5000);

  return await page.evaluate(() => {
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
      const extra = Array.from(commDiv.querySelectorAll("div")).map(d => d.textContent.trim()).filter(t => t && t !== strong).join(" ");
      commodity = [strong, extra].filter(Boolean).join(" ").trim();
    }
    
    function parseDateTime(attr, txt) {
      try {
        const d = new Date(attr);
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const m = txt.match(/(\d+):(\d+)\s*(am|pm)?/i);
        let hr = 0, min = 0;
        if (m) {
          hr = parseInt(m[1]);
          min = parseInt(m[2]);
          const isPM = m[3]?.toLowerCase() === 'pm';
          if (isPM && hr !== 12) hr += 12;
          else if (!isPM && hr === 12) hr = 0;
        }
        return { date: `${mo}/${day}`, time: `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
      } catch {
        return { date: 'N/A', time: 'N/A' };
      }
    }

    const locs = Array.from(document.querySelectorAll('[id^="shipment-location-"]'));
    const pickups = [], deliveries = [];
    let foundPickup = false;

    locs.forEach(loc => {
      const addr = loc.querySelector('address');
      if (!addr) return;

      const lines = Array.from(addr.querySelectorAll('div')).map(d => d.textContent.trim()).filter(Boolean);
      let cityState = lines.length > 1 ? lines[lines.length - 1].replace(/\s*\d{5}(?:-\d{4})?/, "").trim() : "";

      const times = loc.querySelectorAll('.text-right time[datetime]');
      let dateTime = "N/A";
      if (times.length >= 2) {
        const s = parseDateTime(times[0].getAttribute('datetime'), times[0].textContent.trim());
        const e = parseDateTime(times[1].getAttribute('datetime'), times[1].textContent.trim());
        dateTime = `${s.date} ${s.time} - ${e.time}`;
      } else if (times.length === 1) {
        const p = parseDateTime(times[0].getAttribute('datetime'), times[0].textContent.trim());
        dateTime = `${p.date} ${p.time}`;
      }

      const txt = loc.textContent.toLowerCase();
      const isPickup = txt.includes('pick up') || (txt.includes('picked up') && !txt.includes('deliver'));
      const isDelivery = txt.includes('deliver');

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
}

function getFormat2(ref) {
  return {
    subject: `Re: Load Inquiry - ${ref}`,
    body: `Hello,

Thank you for your inquiry regarding load ${ref}.

I've identified this load reference and am currently pulling the complete details from our system. You'll receive:

📦 LOAD INFORMATION:
• Pickup and delivery locations with dates/times  
• Commodity details and weight requirements
• Our competitive rate quote
• Equipment specifications
• Any special handling requirements

This detailed information will be sent within the next few moments.

🚛 TO EXPEDITE: When and where will you be empty for pickup?

We're ready to provide immediate quotes and book qualified loads on the spot.

Best regards,
Balto Booking

---
Professional freight services with real-time load tracking`
  };
}

function getFormat1(data) {
  return {
    subject: `Re: Load Inquiry - ${data.loadReference} - Complete Details`,
    body: `Hello,

Thank you for your inquiry about load ${data.loadReference}. Here are the details:

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
Automated response with live QuoteFactory data`
  };
}

function getFormat3(ref) {
  return {
    subject: `Re: Load Inquiry - DAT Reference Number Needed`,
    body: `Hello,

Thank you for reaching out about this load opportunity.

To provide you with accurate pricing and availability, could you please provide the DAT load reference number or QuoteFactory load ID?

This will help us:
- Pull the exact load details from our system  
- Provide you with competitive pricing
- Respond faster with availability

Once you provide the reference number, we'll get back to you immediately with our quote and capacity.

Thank you!

Best regards,
Balto Booking

---
Automated response - Please reply with DAT reference number`
  };
}

(async () => {
  const ref = process.argv[2] || "302687";
  console.log(`🚀 Processing load: ${ref}\n`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });

  try {
    const page = await browser.newPage();
    const cookies = await loadCookies();
    if (cookies) await page.setCookie(...cookies).catch(() => {});

    try { await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: "networkidle2", timeout: 90000 }); } catch {}
    await wait(5000);

    let loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      console.log("🔐 Logging in...");
      loggedIn = await login(page);
      if (loggedIn) {
        await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
        await wait(3000);
      }
    }
    if (!loggedIn) throw new Error("Login failed");

    // Send Format 2 immediately
    console.log("📤 [1] Sending acknowledgment...");
    const format2 = getFormat2(ref);
    console.log(`\nSubject: ${format2.subject}\n\n${format2.body}\n`);
    
    await wait(CONFIG.FOLLOW_UP_DELAY);

    // Extract and send follow-up
    console.log("🔎 [2] Extracting load details...");
    const data = await searchLoad(page, ref);
    
    const hasCompleteData = data?.loadReference !== "N/A" && data?.pickup !== "N/A" && data?.delivery !== "N/A";
    
    if (hasCompleteData) {
      console.log("✅ Complete data found\n");
      const format1 = getFormat1(data);
      console.log(`Subject: ${format1.subject}\n\n${format1.body}\n`);
    } else {
      console.log("⚠️  Load not found\n");
      const format3 = getFormat3(ref);
      console.log(`Subject: ${format3.subject}\n\n${format3.body}\n`);
    }

    await wait(10000);
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
})().catch(error => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});