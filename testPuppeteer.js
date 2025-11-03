// testPuppeteer.js - Complete version with better timeout handling
import fs from "fs/promises";
import puppeteer from "puppeteer";

const COOKIES_PATH = "./cookies.json";
const DASHBOARD_URL = "https://app.quotefactory.com/broker/dashboard";

const USERNAME = process.env.QF_USERNAME || "emangino@harnesstogo.com";
const PASSWORD = process.env.QF_PASSWORD || "GoBirds143$";

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
      // Wait a bit for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check for dashboard content
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
      waitUntil: "load",  // Changed to 'load' instead of 'domcontentloaded'
      timeout: 90000      // Increased to 90 seconds
    });
    console.log("✅ Page loaded");
  } catch (err) {
    console.log("⚠️  Navigation timeout, but continuing...");
    // Don't throw, just continue
  }

  // Wait a bit for page to settle
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("⏳ Waiting for Auth0 Lock to load...");
  
  try {
    await page.waitForSelector('.auth0-lock-widget', { timeout: 20000 });
    console.log("✅ Auth0 Lock widget loaded");
  } catch (err) {
    console.log("⚠️  Auth0 Lock widget not found, checking if already logged in...");
    
    // Maybe we're already logged in?
    if (await isLoggedIn(page)) {
      console.log("✅ Already logged in!");
      return true;
    }
    
    await page.screenshot({ path: "login-page-error.png", fullPage: true });
    throw new Error("Auth0 Lock widget did not load and not logged in");
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log("🔍 Looking for email input field...");
  
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input#1-email',
    '.auth0-lock-input[type="email"]'
  ];

  let emailInput = null;
  for (const selector of emailSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        emailInput = selector;
        console.log(`✅ Found email input with selector: ${selector}`);
        break;
      }
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!emailInput) {
    throw new Error("Email input not found");
  }

  console.log("🖊️ Filling credentials...");
  
  await page.click(emailInput, { clickCount: 3 });
  await page.type(emailInput, USERNAME, { delay: 100 });
  console.log("✅ Email filled");

  await new Promise(resolve => setTimeout(resolve, 1000));

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    '.auth0-lock-input[type="password"]'
  ];

  let passwordInput = null;
  for (const selector of passwordSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        passwordInput = selector;
        console.log(`✅ Found password input with selector: ${selector}`);
        break;
      }
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!passwordInput) {
    throw new Error("Password input not found");
  }

  await page.click(passwordInput, { clickCount: 3 });
  await page.type(passwordInput, PASSWORD, { delay: 100 });
  console.log("✅ Password filled");

  await new Promise(resolve => setTimeout(resolve, 1000));

  const submitSelectors = [
    'button[type="submit"]',
    'button[name="submit"]',
    'button[name="action"]',
    '.auth0-lock-submit'
  ];

  let submitButton = null;
  for (const selector of submitSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        submitButton = selector;
        console.log(`✅ Found submit button with selector: ${selector}`);
        break;
      }
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!submitButton) {
    throw new Error("Submit button not found");
  }

  console.log("🔐 Submitting login form...");
  
  await page.click(submitButton);
  console.log("✅ Submit button clicked");
  
  // Don't wait for navigation, just wait a fixed time
  console.log("⏳ Waiting for login to process...");
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const logged = await isLoggedIn(page);
  
  console.log("Current URL:", page.url());
  
  if (!logged) {
    console.log("⚠️  Not on dashboard yet, taking screenshot");
    await page.screenshot({ path: "after-login-attempt.png", fullPage: true });
  } else {
  console.log("✅ Logged in successfully!");
  await saveCookies(page);
  return true; // <--- add this line
}
  
  return logged;
}

// === IMPROVED: Function to search and extract load details ===
async function searchLoad(page, reference) {
  console.log(`\n🔎 Searching for load reference: ${reference}`);

  try {
    // Step 1: Open search
    console.log("⌨️  Opening search with Ctrl+K...");
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 2: Wait for search field
    console.log("⏳ Waiting for search field...");
    
    let searchFieldFound = false;
    try {
      await page.waitForSelector('#search_field', { timeout: 5000 });
      searchFieldFound = true;
      console.log("✅ Search field appeared!");
    } catch (err) {
      console.log("⚠️  Ctrl+K didn't work, trying to click search button...");
    }
    
    // If Ctrl+K didn't work, try clicking the button
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
        await page.screenshot({ path: "search-not-opened.png", fullPage: true });
      }
    }
    
    if (!searchFieldFound) {
      throw new Error("Search field not found");
    }
    
    console.log("✅ Search field is ready!");
    
    // Step 3: Type the reference
    console.log(`⌨️  Typing load reference: ${reference}`);
    await page.click('#search_field', { clickCount: 3 });
    await page.type('#search_field', reference, { delay: 100 });
    console.log(`✅ Typed: ${reference}`);
    
    // Take screenshot of search box with text
    await page.screenshot({ path: "search-typed.png", fullPage: true });
    console.log("📸 Screenshot: search-typed.png");
    
    // Step 4: Press Enter
    console.log("⏎ Pressing Enter to search...");
    await page.keyboard.press('Enter');
    console.log("✅ Enter pressed");
    
    // Step 5: Wait for page to change/load
    console.log("⏳ Waiting for search results to load...");
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Take screenshot of results
    await page.screenshot({ path: "search-results.png", fullPage: true });
    console.log("📸 Screenshot: search-results.png");
    
    // Step 6: Show what's actually on the page
    console.log("\n📄 Analyzing page content...");
    
    const pageAnalysis = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const allText = bodyText.substring(0, 3000);
      
      const hasPickup = bodyText.toLowerCase().includes('pickup');
      const hasDelivery = bodyText.toLowerCase().includes('delivery');
      const hasWeight = bodyText.toLowerCase().includes('weight');
      const hasRate = bodyText.toLowerCase().includes('rate');
      const hasLoad = bodyText.toLowerCase().includes('load');
      
      const currentUrl = window.location.href;
      
      const loadElements = {
        divs: document.querySelectorAll('div').length,
        spans: document.querySelectorAll('span').length,
        paragraphs: document.querySelectorAll('p').length,
        hasTable: !!document.querySelector('table'),
        hasForm: !!document.querySelector('form')
      };
      
      return {
        currentUrl,
        allText,
        keywords: { hasPickup, hasDelivery, hasWeight, hasRate, hasLoad },
        elements: loadElements
      };
    });
    
    console.log("\n🌐 Current URL:", pageAnalysis.currentUrl);
    console.log("\n🔑 Keywords found:");
    console.log("  - Pickup:", pageAnalysis.keywords.hasPickup ? "✅" : "❌");
    console.log("  - Delivery:", pageAnalysis.keywords.hasDelivery ? "✅" : "❌");
    console.log("  - Weight:", pageAnalysis.keywords.hasWeight ? "✅" : "❌");
    console.log("  - Rate:", pageAnalysis.keywords.hasRate ? "✅" : "❌");
    console.log("  - Load:", pageAnalysis.keywords.hasLoad ? "✅" : "❌");
    
    console.log("\n📊 Page elements:");
    console.log("  - Divs:", pageAnalysis.elements.divs);
    console.log("  - Spans:", pageAnalysis.elements.spans);
    console.log("  - Has table:", pageAnalysis.elements.hasTable);
    
    console.log("\n📄 FULL PAGE TEXT (first 3000 chars):");
    console.log("=====================================");
    console.log(pageAnalysis.allText);
    console.log("=====================================");

    // Step 7: Try to extract with better patterns
    const loadInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      
      const pickupMatch = text.match(/(?:Pickup|Origin|From)[:\s]*([^\n]{10,80})/i);
      const deliveryMatch = text.match(/(?:Delivery|Destination|To)[:\s]*([^\n]{10,80})/i);
      const weightMatch = text.match(/(?:Weight|Pounds|lbs)[:\s]*([^\n]{5,30})/i);
      const rateMatch = text.match(/(?:Rate|Price|Cost)[:\s]*\$?([^\n]{3,20})/i);
      
      return { 
        pickup: pickupMatch?.[1]?.trim() || "N/A",
        delivery: deliveryMatch?.[1]?.trim() || "N/A",
        weight: weightMatch?.[1]?.trim() || "N/A",
        rate: rateMatch?.[1]?.trim() || "N/A"
      };
    });

    console.log("\n📦 EXTRACTED LOAD INFO:");
    console.log("  Pickup:", loadInfo.pickup);
    console.log("  Delivery:", loadInfo.delivery);
    console.log("  Weight:", loadInfo.weight);
    console.log("  Rate:", loadInfo.rate);

    const formatted = `
📦 LOAD DETAILS (Load ${reference}):
- Pickup: ${loadInfo.pickup}
- Delivery: ${loadInfo.delivery}
- Weight: ${loadInfo.weight}
- Rate: ${loadInfo.rate}

🚛 CAPACITY INQUIRY:
When and where will you be empty for pickup?
    `.trim();

    console.log("\n🧾 Formatted Output:\n");
    console.log(formatted);
    
    return { loadInfo, formatted, pageText: pageAnalysis.allText };
    
  } catch (err) {
    console.error(`❌ Error during load search:`, err.message);
    await page.screenshot({ path: "search-error.png", fullPage: true });
    console.log("📸 Error screenshot: search-error.png");
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

  console.log("🌐 Starting QuoteFactory automation...");
  
  // Try with cookies first
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    console.log("🍪 Found saved cookies, applying...");
    try {
      await page.setCookie(...cookies);
      console.log("✅ Cookies applied");
    } catch (err) {
      console.warn("⚠️  Failed to set cookies:", err.message);
    }
    
    // Try to go to dashboard with cookies
    try {
      await page.goto(DASHBOARD_URL, { 
        waitUntil: "domcontentloaded",
        timeout: 60000 
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (await isLoggedIn(page)) {
        console.log("✅ Logged in via cookies!");
        
        // Search for load
        let loadReference = process.argv[2] || "289926";
        const result = await searchLoad(page, loadReference);
        
        if (result) {
          console.log("\n✅ ✅ ✅ Load search completed!");
        }
        
        await page.screenshot({ path: "final-state.png", fullPage: true });
        console.log("\n✨ Done! Browser will stay open for 30 seconds.");
        await new Promise(resolve => setTimeout(resolve, 30000));
        await browser.close();
        return;
      }
    } catch (err) {
      console.log("⚠️  Cookies didn't work, will try login form");
    }
  }

  // If cookies didn't work, do fresh login
  console.log("\n🔐 Performing fresh login...");
  const loggedIn = await loginWithForm(page);
  
  if (loggedIn) {
    console.log("\n✅ Successfully logged in!");
    
    // Navigate to dashboard
    try {
      await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.log("⚠️  Dashboard navigation issue");
    }
    
    // Search for load
    let loadReference = process.argv[2] || "289926";
    console.log(`\n🎯 Searching for load: ${loadReference}`);
    
    const result = await searchLoad(page, loadReference);
    
    if (result) {
      console.log("\n✅ ✅ ✅ Load search completed!");
    } else {
      console.log("\n⚠️  Could not complete load search");
    }
  } else {
    console.log("\n❌ Login failed");
    console.log("Check login-state.png and after-login.png screenshots");
  }

  await page.screenshot({ path: "final-state.png", fullPage: true });
  console.log("\n📸 Final screenshot: final-state.png");
  console.log("\n✨ Done! Browser will stay open for 30 seconds.");
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  await browser.close();
  console.log("👋 Browser closed");
})().catch(error => {
  console.error("\n❌ Script failed:", error.message);
  console.error(error.stack);
  process.exit(1);
});