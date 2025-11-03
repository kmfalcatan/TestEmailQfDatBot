// testPuppeteer.js - Fixed version with better auth detection
import "dotenv/config";
import fs from "fs/promises";
import puppeteer from "puppeteer";

const COOKIES_PATH = "./cookies.json";
const DASHBOARD_URL = "https://app.quotefactory.com/broker/dashboard";

const USERNAME = process.env.QF_USERNAME;
const PASSWORD = process.env.QF_PASSWORD;

async function loadCookies() {
  try {
    const raw = await fs.readFile(COOKIES_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log("✅ Cookies saved to", COOKIES_PATH);
}

async function isLoggedIn(page) {
  const url = page.url();
  console.log("🔍 Checking URL:", url);
  
  if (url.includes('auth.quotefactory.com')) {
    console.log("❌ Still on auth page - NOT logged in");
    return false;
  }
  
  if (url.includes('/broker/dashboard') || url.includes('app.quotefactory.com')) {
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const hasDashboard = await page.evaluate(() => {
        const text = document.body.textContent || '';
        const hasNav = document.querySelector('nav, header, [role="navigation"]');
        const hasButton = document.querySelector('button');
        const hasSearchText = text.toLowerCase().includes('find');
        return !!(hasNav || hasButton || hasSearchText);
      });
      
      if (hasDashboard) {
        console.log("✅ Dashboard elements found - LOGGED IN");
        return true;
      }
    } catch (err) {
      console.log("⚠️  Could not verify dashboard - " + err.message);
    }
  }
  
  return false;
}

async function loginWithForm(page) {
  console.log("🌐 Navigating to login page...");
  
  try {
    await page.goto('https://app.quotefactory.com', { 
      waitUntil: "networkidle2",
      timeout: 90000
    });
    console.log("✅ Page loaded");
  } catch (err) {
    console.log("⚠️  Navigation issue:", err.message);
  }

  // Wait longer for page to settle
  console.log("⏳ Waiting for page to fully load...");
  await new Promise(resolve => setTimeout(resolve, 8000));

  // Check if we're already logged in
  if (await isLoggedIn(page)) {
    console.log("✅ Already logged in!");
    return true;
  }

  console.log("🔍 Looking for login form elements...");
  
  // Try multiple approaches to find the login form
  let loginFormFound = false;
  let emailInput = null;
  let passwordInput = null;
  
  // Approach 1: Look for Auth0 Lock widget
  try {
    await page.waitForSelector('.auth0-lock-widget', { timeout: 10000 });
    console.log("✅ Auth0 Lock widget found");
    loginFormFound = true;
  } catch (err) {
    console.log("⚠️  Auth0 Lock widget not found, trying alternative selectors...");
  }
  
  // Approach 2: Look for any login form elements
  if (!loginFormFound) {
    try {
      await page.waitForFunction(() => {
        const emailInputs = document.querySelectorAll('input[type="email"], input[type="text"], input[name="email"], input[name="username"]');
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        return emailInputs.length > 0 && passwordInputs.length > 0;
      }, { timeout: 15000 });
      console.log("✅ Login form elements found");
      loginFormFound = true;
    } catch (err) {
      console.log("⚠️  Login form elements not found");
    }
  }
  
  // Approach 3: Check if we're on auth0 page and wait for it to load
  if (!loginFormFound && page.url().includes('auth.quotefactory.com')) {
    console.log("🔄 On Auth0 page, waiting for form to render...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check again for form elements
    const hasForm = await page.evaluate(() => {
      const emailInputs = document.querySelectorAll('input[type="email"], input[type="text"]');
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      return emailInputs.length > 0 && passwordInputs.length > 0;
    });
    
    if (hasForm) {
      console.log("✅ Form loaded after waiting");
      loginFormFound = true;
    }
  }
  
  if (!loginFormFound) {
    throw new Error("Login form not found after multiple attempts");
  }

  // Find email input with multiple selectors
  console.log("🔍 Looking for email input field...");
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id*="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
    '.auth0-lock-input[type="email"]',
    'input[type="text"]'
  ];

  for (const selector of emailSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }, element);
        
        if (isVisible) {
          emailInput = selector;
          console.log(`✅ Found visible email input with selector: ${selector}`);
          break;
        }
      }
    } catch (err) {
      // Continue trying other selectors
    }
  }

  if (!emailInput) {
    throw new Error("Email input not found");
  }

  console.log("🖊️ Filling email...");
  await page.waitForSelector(emailInput, { visible: true, timeout: 5000 });
  await page.click(emailInput, { clickCount: 3 });
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.type(emailInput, USERNAME, { delay: 100 });
  console.log("✅ Email filled");

  await new Promise(resolve => setTimeout(resolve, 1500));

  // Find password input
  console.log("🔍 Looking for password input field...");
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password"]',
    'input[placeholder*="password" i]',
    '.auth0-lock-input[type="password"]'
  ];

  for (const selector of passwordSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }, element);
        
        if (isVisible) {
          passwordInput = selector;
          console.log(`✅ Found visible password input with selector: ${selector}`);
          break;
        }
      }
    } catch (err) {
      // Continue trying other selectors
    }
  }

  if (!passwordInput) {
    throw new Error("Password input not found");
  }

  console.log("🖊️ Filling password...");
  await page.waitForSelector(passwordInput, { visible: true, timeout: 5000 });
  await page.click(passwordInput, { clickCount: 3 });
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.type(passwordInput, PASSWORD, { delay: 100 });
  console.log("✅ Password filled");

  await new Promise(resolve => setTimeout(resolve, 1500));

  // Find submit button
  console.log("🔍 Looking for submit button...");
  const submitSelectors = [
    'button[type="submit"]',
    'button[name="submit"]',
    'button[name="action"]',
    'input[type="submit"]',
    '.auth0-lock-submit',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Continue")'
  ];

  let submitButton = null;
  for (const selector of submitSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }, element);
        
        if (isVisible) {
          submitButton = selector;
          console.log(`✅ Found visible submit button with selector: ${selector}`);
          break;
        }
      }
    } catch (err) {
      // Continue trying other selectors
    }
  }
  
  // Fallback: find button by text content
  if (!submitButton) {
    console.log("🔍 Trying to find submit button by text content...");
    submitButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const submitBtn = buttons.find(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('log in') || text.includes('sign in') || text.includes('continue') || text.includes('submit');
      });
      
      if (submitBtn) {
        submitBtn.setAttribute('data-puppeteer-submit', 'true');
        return '[data-puppeteer-submit="true"]';
      }
      return null;
    });
    
    if (submitButton) {
      console.log("✅ Found submit button by text content");
    }
  }

  if (!submitButton) {
    throw new Error("Submit button not found");
  }

  console.log("🔐 Submitting login form...");
  await page.click(submitButton);
  console.log("✅ Submit button clicked");
  
  console.log("⏳ Waiting for login to process...");
  
  // Wait for navigation or dashboard to appear
  try {
    await page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle2' });
    console.log("✅ Navigation completed");
  } catch (err) {
    console.log("⚠️  Navigation wait timeout, checking login status anyway...");
  }
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const logged = await isLoggedIn(page);
  
  console.log("Current URL:", page.url());
  
  if (!logged) {
    console.log("⚠️  Not on dashboard yet, waiting a bit longer...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    const logged2 = await isLoggedIn(page);
    
    if (logged2) {
      console.log("✅ Logged in successfully!");
      await saveCookies(page);
      return true;
    } else {
      console.log("❌ Login appears to have failed");
      return false;
    }
  } else {
    console.log("✅ Logged in successfully!");
    await saveCookies(page);
    return true;
  }
}

// === IMPROVED: Function to search and extract load details ===
async function searchLoad(page, reference) {
  console.log(`\n🔎 Searching for load reference: ${reference}`);

  try {
    console.log("⌨️  Opening search with Ctrl+K...");
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("⏳ Waiting for search field...");
    
    let searchFieldFound = false;
    try {
      await page.waitForSelector('#search_field', { timeout: 5000 });
      searchFieldFound = true;
      console.log("✅ Search field appeared!");
    } catch (err) {
      console.log("⚠️  Ctrl+K didn't work, trying to click search button...");
    }
    
    if (!searchFieldFound) {
      try {
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const searchBtn = buttons.find(btn => 
            btn.textContent.includes('Find') || 
            btn.textContent.includes('anything')
          );
          if (searchBtn) {
            searchBtn.click();
            return true;
          }
          return false;
        });
        console.log("✅ Clicked search button");
        await new Promise(resolve => setTimeout(resolve, 2000));
        await page.waitForSelector('#search_field', { timeout: 5000 });
        searchFieldFound = true;
      } catch (err) {
        console.log("❌ Could not open search");
      }
    }
    
    if (!searchFieldFound) {
      throw new Error("Search field not found");
    }
    
    console.log("✅ Search field is ready!");
    
    console.log(`⌨️  Typing load reference: ${reference}`);
    await page.click('#search_field', { clickCount: 3 });
    await page.type('#search_field', reference, { delay: 100 });
    console.log(`✅ Typed: ${reference}`);
    
    console.log("⏎ Pressing Enter to search...");
    await page.keyboard.press('Enter');
    console.log("✅ Enter pressed");
    
    console.log("⏳ Waiting for search results to load...");
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log("\n📄 Extracting load information...");
    
    // Extract all the load information from the page
    const loadInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      
      // Extract load reference
      const refMatch = text.match(/Shipments[\s\n]+(\d+)/i) || text.match(/(\d{6})/);
      const loadReference = refMatch ? refMatch[1] : "N/A";
      
      // Extract status
      const statusMatch = text.match(/(Booked|Requested|Scheduled|In transit)/i);
      const status = statusMatch ? statusMatch[1] : "N/A";
      
      // Extract ALL dates (pickup and delivery)
      const dateMatches = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/gi);
      const pickupDate = dateMatches && dateMatches[0] ? dateMatches[0] : "N/A";
      const deliveryDate = dateMatches && dateMatches[1] ? dateMatches[1] : "N/A";
      
      // Extract customer
      const customerMatch = text.match(/\$[\d,]+\.?\d*\s*\n\s*([^\n]+)\s*\n\s*[A-Z]{2}/);
      const customer = customerMatch ? customerMatch[1].trim() : "N/A";
      
      // Extract rate
      const rateMatch = text.match(/\$[\d,]+\.?\d*/);
      const rate = rateMatch ? rateMatch[0] : "N/A";
      
      // Detect PICK UP sections and extract their locations
const pickupSections = Array.from(document.querySelectorAll('div.text-12.text-gray-800.font-semibold.tracking-wide.pr-4'))
  .filter(div => div.textContent.trim().toUpperCase().includes('PICK UP'));

const pickupLocations = pickupSections.map(section => {
  const parent = section.closest('div');
  if (!parent) return null;
  const text = parent.innerText;
  const match = text.match(/([A-Za-z\s]+),\s*([A-Z]{2})/);
  return match ? `${match[1].trim()}, ${match[2]}` : null;
}).filter(Boolean);

let pickup = "N/A";
let delivery = "N/A";

if (pickupLocations.length > 1) {
  // If there are multiple pickup locations
  pickup = pickupLocations.join(' | '); // join them
  delivery = pickup; // set the same string as delivery
} else {
  // Fallback to your previous regex-based logic
  const locationMatches = Array.from(text.matchAll(/([^\n]{3,40})\s*\n\s*([A-Z]{2})\b/g));
  if (locationMatches.length >= 2) {
    const pickupCity = locationMatches[0][1].trim();
    const pickupState = locationMatches[0][2];
    pickup = `${pickupCity}, ${pickupState}`;
    
    const deliveryCity = locationMatches[1][1].trim();
    const deliveryState = locationMatches[1][2];
    delivery = `${deliveryCity}, ${deliveryState}`;
  } else if (locationMatches.length === 1) {
    const pickupCity = locationMatches[0][1].trim();
    const pickupState = locationMatches[0][2];
    pickup = `${pickupCity}, ${pickupState}`;
  }
}
      
      // Extract weight
      const weightMatch = text.match(/([\d,]+)\s*lb/i);
      const weight = weightMatch ? `${weightMatch[1]} lbs` : "N/A";
      
      // Extract equipment type
      const equipmentMatch = text.match(/(Other|Dry Van|Reefer|Flatbed)/i);
      const equipment = equipmentMatch ? equipmentMatch[1] : "N/A";
      
      // Extract carrier
      const carrierMatch = text.match(/No carrier|([A-Z][^\n]+LLC|[A-Z][^\n]+Inc)/);
      const carrier = carrierMatch ? (carrierMatch[0] === "No carrier" ? "No carrier assigned" : carrierMatch[1]) : "N/A";
      
      return { 
        loadReference,
        status,
        pickupDate,
        deliveryDate,
        customer,
        rate,
        pickup,
        delivery,
        weight,
        equipment,
        carrier
      };
    });

    console.log("\n📦 EXTRACTED LOAD INFO:");
    console.log("  Load Reference:", loadInfo.loadReference);
    console.log("  Status:", loadInfo.status);
    console.log("  Pickup Date:", loadInfo.pickupDate);
    console.log("  Pickup Location:", loadInfo.pickup);
    console.log("  Delivery Date:", loadInfo.deliveryDate);
    console.log("  Delivery Location:", loadInfo.delivery);
    console.log("  Customer:", loadInfo.customer);
    console.log("  Rate:", loadInfo.rate);
    console.log("  Weight:", loadInfo.weight);
    console.log("  Equipment:", loadInfo.equipment);
    console.log("  Carrier:", loadInfo.carrier);

    const formatted = `Hello,

Thank you for your inquiry about load ${loadInfo.loadReference}. Here are the details:

📦 LOAD DETAILS:
- Pickup: ${loadInfo.pickup}, ${loadInfo.pickupDate}
- Delivery: ${loadInfo.delivery}, ${loadInfo.deliveryDate}
- Weight: ${loadInfo.weight}
- Rate: ${loadInfo.rate}

🚛 CAPACITY INQUIRY:
When and where will you be empty for pickup?

Best regards,
Balto Booking

---
Automated response with live QuoteFactory data
    `.trim();

    console.log("\n🧾 FORMATTED OUTPUT:");
    console.log(formatted);
    
    return { loadInfo, formatted };
    
  } catch (err) {
    console.error(`❌ Error during load search:`, err.message);
    return null;
  }
}

// === MAIN EXECUTION ===
(async () => {
  console.log("🚀 Launching browser...");
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log("🌐 Navigating to QuoteFactory...");
  
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    console.log("🍪 Found cookies, applying...");
    try {
      await page.setCookie(...cookies);
    } catch (err) {
      console.warn("⚠️ Failed to set cookies:", err.message);
    }
  }

  console.log("⏳ Checking login status...");
  
  try {
    await page.goto(DASHBOARD_URL, { 
      waitUntil: "networkidle2",
      timeout: 90000 
    });
  } catch (err) {
    console.log("⚠️  Navigation timeout (continuing anyway)");
  }
  
  await new Promise(resolve => setTimeout(resolve, 5000));

  let loggedIn = await isLoggedIn(page);
  
  if (!loggedIn) {
    console.log("🔁 Cookies invalid or absent — performing form login");
    loggedIn = await loginWithForm(page);
    
    if (loggedIn) {
      console.log("✅ Login successful, navigating to dashboard...");
      try {
        await page.goto(DASHBOARD_URL, { waitUntil: "networkidle2", timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        console.log("⚠️  Dashboard navigation timeout");
      }
    }
  } else {
    console.log("✅ Logged in via saved cookies");
  }

  if (loggedIn) {
    let loadReference = process.argv[2];
    if (!loadReference) {
      console.log("⚠️  No load reference provided");
      console.log("Usage: node testPuppeteer.js 282032");
      loadReference = "282032";
      console.log(`Using default: ${loadReference}`);
    }

    const result = await searchLoad(page, loadReference);
    
    if (result) {
      console.log("\n✅ ✅ ✅ Load search completed successfully!");
    } else {
      console.log("\n⚠️  Could not extract complete load data");
    }
  } else {
    console.log("\n❌ Login failed - cannot search for loads");
  }

  console.log("\n✨ Done! Browser will stay open for 30 seconds.");
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  await browser.close();
  console.log("👋 Browser closed");
})().catch(error => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});