// api/webhook.js
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// -----------------------------
// Utility helpers
// -----------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await page.evaluate(e => getComputedStyle(e).display !== 'none', el)) return sel;
    } catch {}
  }
  return null;
}

async function isLoggedIn(page) {
  if (page.url().includes('auth.quotefactory.com')) return false;
  if (page.url().includes('app.quotefactory.com')) {
    await wait(2000);
    return page.evaluate(() =>
      !!(document.querySelector('nav, header, button') || document.body.textContent.includes('find'))
    );
  }
  return false;
}

async function login(page) {
  const username = process.env.QUOTEFACTORY_USERNAME;
  const password = process.env.QUOTEFACTORY_PASSWORD;

  if (!username || !password) throw new Error("Missing credentials");

  try { await page.goto("https://app.quotefactory.com", { waitUntil: "networkidle2" }); } catch {}
  await wait(8000);
  if (await isLoggedIn(page)) return true;

  try {
    await page.waitForSelector(".auth0-lock-widget", { timeout: 10000 });
    await wait(3000);
  } catch {
    await page.waitForFunction(() =>
      document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2
    );
  }

  const emailSel = await findVisible(page, [
    'input[type="email"]', 'input[name="email"]', 'input[name="username"]'
  ]);
  if (!emailSel) throw new Error("Email input not found");
  await page.click(emailSel, { clickCount: 3 });
  await wait(500);
  await page.type(emailSel, username, { delay: 100 });

  const passSel = await findVisible(page, [
    'input[type="password"]', 'input[name="password"]'
  ]);
  if (!passSel) throw new Error("Password input not found");
  await page.click(passSel, { clickCount: 3 });
  await wait(500);
  await page.type(passSel, password, { delay: 100 });

  let submitSel = await findVisible(page, [
    'button[type="submit"]', 'button[name="submit"]', '.auth0-lock-submit'
  ]);
  if (!submitSel) {
    submitSel = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => /log in|sign in|continue/i.test(b.textContent));
      if (btn) { btn.setAttribute("data-submit", "1"); return '[data-submit="1"]'; }
      return null;
    });
  }
  if (!submitSel) throw new Error("Submit button not found");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    page.click(submitSel)
  ]);
  await wait(5000);

  const loggedIn = await isLoggedIn(page);
  return loggedIn;
}

async function searchLoad(page, ref) {
  console.log(`🔍 Searching for load reference: ${ref}`);

  // Navigate to Loads page
  await page.goto("https://app.quotefactory.com/broker/dashboard", { waitUntil: "networkidle2" });
  await wait(4000);

  // Try to open search bar
  try {
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyK");
    await page.keyboard.up("Control");
    await wait(2000);
  } catch {}

  try {
    await page.waitForSelector("#search_field", { timeout: 8000 });
  } catch {
    await page.evaluate(() => {
      Array.from(document.querySelectorAll("button")).find(b => /find|anything/i.test(b.textContent))?.click();
    });
    await wait(2000);
    await page.waitForSelector("#search_field", { timeout: 8000 });
  }

  await page.click("#search_field", { clickCount: 3 });
  await page.type("#search_field", ref, { delay: 100 });
  await page.keyboard.press("Enter");
  await wait(8000);

  // Click into load card
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
    const priceDiv = document.querySelector(".text-right.py-2.font-bold.order-last.px-3");
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

    const locs = Array.from(document.querySelectorAll('[id^="shipment-location-"]'));
    const pickups = [], deliveries = [];
    locs.forEach((loc, i) => {
      const addr = loc.querySelector("address");
      if (!addr) return;
      const lines = Array.from(addr.querySelectorAll("div")).map(d => d.textContent.trim()).filter(Boolean);
      let cityState = lines.length > 1 ? lines[lines.length - 1].replace(/\s*\d{5}(?:-\d{4})?/, "").trim() : "";
      const txt = loc.textContent.toLowerCase();
      if (txt.includes("pick up")) pickups.push(cityState);
      if (txt.includes("deliver")) deliveries.push(cityState);
    });

    const pickup = pickups.length ? pickups.join(", ") : "N/A";
    const delivery = deliveries.length ? deliveries.join(", ") : "N/A";

    return { loadReference, rate, weight, pickup, delivery };
  });
}

// -----------------------------
// Email formatting
// -----------------------------
function getFormat1(data) {
  return {
    subject: `Re: Load Inquiry - ${data.loadReference} - Complete Details`,
    body: `Hello,

Thank you for your inquiry about load ${data.loadReference}. Here are the details:

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
Automated response with live QuoteFactory data`
  };
}

function getFormat2(ref) {
  return {
    subject: `Re: Load Inquiry - ${ref}`,
    body: `Hello,

Thank you for your inquiry regarding load ${ref}.

I've identified this load reference and am currently pulling the complete details from our system.
You'll receive complete information shortly.

Best regards,
Balto Booking

---
Professional freight services with real-time load tracking`
  };
}

function getFormat3(ref) {
  return {
    subject: `Re: Load Inquiry - DAT Reference Needed`,
    body: `Hello,

Please provide the DAT or QuoteFactory load reference number to retrieve details.

Thanks,
Balto Booking`
  };
}

function extractLoadRef(emailBody = "") {
  const patterns = [
    /order\s*#?\s*(\d{5,8})/i,
    /reference\s+number\s+(\d{5,8})/i,
    /ref[:\s]+(\d{5,8})/i,
    /\b(\d{5,8})\b/i
  ];
  for (const p of patterns) {
    const m = emailBody.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// -----------------------------
// Main webhook handler
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const emailBody = req.body.bodyPreview || req.body.body?.content || "";
  const subject = req.body.subject || "Load Inquiry";
  const loadRef = extractLoadRef(emailBody);

  if (!loadRef) {
    const { subject: s, body: b } = getFormat3();
    return res.json({ success: true, responseSubject: s, responseBody: b });
  }

  console.log(`🚀 Processing load reference: ${loadRef}`);
  let data = null;

  const launchOptions = {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  };

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  try {
    const loggedIn = await login(page);
    if (loggedIn) data = await searchLoad(page, loadRef);
  } catch (err) {
    console.error("❌ Puppeteer error:", err.message);
  } finally {
    await browser.close();
  }

  const hasData = data && data.loadReference !== "N/A" && data.pickup !== "N/A" && data.delivery !== "N/A";
  const format = hasData ? getFormat1(data) : getFormat2(loadRef);

  res.json({
    success: true,
    loadRef,
    data,
    responseSubject: format.subject,
    responseBody: format.body,
    timestamp: new Date().toISOString(),
  });
}

// Required for Vercel timeout
export const config = { maxDuration: 60 };
