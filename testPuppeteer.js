// testPuppeteer.js - FIXED with better waiting and debugging
import fs from "fs/promises";
import puppeteer from "puppeteer";

const COOKIES_PATH = "./cookies.json";
const LOGIN_URL = "https://auth.quotefactory.com/login?state=hKFo2SA3TnowdXl5dFVkYk9oMWZldlpVZEh0ZzRJc1VUMXNRN6FupWxvZ2luo3RpZNkgVzBpdjJGcnp2OUU3VzYtNXduZkVFT1RUNFoxZVpBeUqjY2lk2SBCT1JORU01b2hhUk8yZ3JOTTk0WmttaFBEMDBFbUlicw&client=BORNEM5ohaRO2grNM94ZkmhPD00EmIbs&protocol=oauth2&scope=openid%20profile%20email&audience=https%3A%2F%2Fapi.quotefactory.com&redirect_uri=https%3A%2F%2Fapp.quotefactory.com%2Fauth&response_type=code&response_mode=query&nonce=X01OTGJienBXamQwbjQ5dlFwNHpuZVJ3N2dDOGJZYkJIM1ZpOFhvR0lyZQ%3D%3D&code_challenge=YK9k8JtNKILBoo8RotWSFX1Ldj_MKA2qlqr8u1zCbYk&code_challenge_method=S256&auth0Client=eyJuYW1lIjoiYXV0aDAtc3BhLWpzIiwidmVyc2lvbiI6IjIuMS4zIn0%3D";
const DASHBOARD_URL = "https://app.quotefactory.com/broker/dashboard";
const LOGGED_IN_CHECK = ".auth0-lock-widget"; // Check if we're still on login page

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
  
  // If we're on auth page, definitely not logged in
  if (url.includes('auth.quotefactory.com')) {
    console.log("❌ Still on auth page - NOT logged in");
    return false;
  }
  
  // If we're on dashboard, check for actual dashboard content
  if (url.includes('/broker/dashboard') || url.includes('app.quotefactory.com')) {
    try {
      // Wait for dashboard elements to confirm we're really logged in
      // This could be a navigation menu, user profile, or any dashboard-specific element
      await page.waitForSelector('nav, header, [role="navigation"]', { timeout: 3000 });
      console.log("✅ Dashboard elements found - LOGGED IN");
      return true;
    } catch (err) {
      console.log("⚠️  On app domain but no dashboard elements - NOT logged in");
      return false;
    }
  }
  
  return false;
}

async function loginWithForm(page) {
  console.log("🌐 Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });

  console.log("⏳ Waiting for Auth0 Lock to load...");
  
  // Wait for the Auth0 Lock widget to appear
  try {
    await page.waitForSelector('.auth0-lock-widget', { timeout: 15000 });
    console.log("✅ Auth0 Lock widget loaded");
  } catch (err) {
    console.log("⚠️  Auth0 Lock widget not found, taking screenshot for debugging...");
    await page.screenshot({ path: "login-page-error.png", fullPage: true });
    throw new Error("Auth0 Lock widget did not load");
  }

  // Give it extra time to fully render
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log("🔍 Looking for email input field...");
  
  // Try multiple possible selectors for email
  const emailSelectors = [
    'input#1-email',
    'input[type="email"]',
    'input[name="email"]',
    '.auth0-lock-input[type="email"]'
  ];

  let emailInput = null;
  for (const selector of emailSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      emailInput = selector;
      console.log(`✅ Found email input with selector: ${selector}`);
      break;
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!emailInput) {
    console.log("❌ Could not find email input field");
    await page.screenshot({ path: "no-email-field.png", fullPage: true });
    
    // Debug: show what's on the page
    const content = await page.content();
    console.log("\n📄 Page contains 'input':", content.includes('<input'));
    console.log("📄 Page contains 'email':", content.includes('email'));
    
    throw new Error("Email input not found");
  }

  console.log("🖊️ Filling credentials...");
  
  // Fill email
  await page.click(emailInput, { clickCount: 3 });
  await page.type(emailInput, USERNAME, { delay: 50 });
  console.log("✅ Email filled");

  // Wait a bit before password
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find password field
  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    '.auth0-lock-input[type="password"]'
  ];

  let passwordInput = null;
  for (const selector of passwordSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      passwordInput = selector;
      console.log(`✅ Found password input with selector: ${selector}`);
      break;
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!passwordInput) {
    throw new Error("Password input not found");
  }

  // Fill password
  await page.click(passwordInput, { clickCount: 3 });
  await page.type(passwordInput, PASSWORD, { delay: 50 });
  console.log("✅ Password filled");

  // Wait before submitting
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find and click submit button
  const submitSelectors = [
    'button[name="submit"]',
    'button[type="submit"]',
    '.auth0-lock-submit'
  ];

  let submitButton = null;
  for (const selector of submitSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      submitButton = selector;
      console.log(`✅ Found submit button with selector: ${selector}`);
      break;
    } catch (err) {
      console.log(`⚠️  Selector ${selector} not found, trying next...`);
    }
  }

  if (!submitButton) {
    throw new Error("Submit button not found");
  }

  console.log("🔐 Submitting login form...");
  
  // Click submit and wait for navigation
  await Promise.all([
    page.click(submitButton),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(err => {
      console.log("⚠️  Navigation timeout (might be ok):", err.message);
    })
  ]);

  // Wait a bit more for page to settle
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const logged = await isLoggedIn(page);
  
  console.log("Current URL:", page.url());
  
  if (!logged) {
    console.log("⚠️  Not on dashboard yet");
    await page.screenshot({ path: "after-login-attempt.png", fullPage: true });
  } else {
    console.log("✅ Logged in successfully!");
    await saveCookies(page);
  }
  
  return logged;
}

(async () => {
  console.log("🚀 Launching browser...");
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();

  console.log("🌐 Navigating to QuoteFactory...");
  
  // Try loading cookies
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
  
  // Go to dashboard to check if cookies worked
  await page.goto(DASHBOARD_URL, { waitUntil: "networkidle2", timeout: 30000 });
  
  // Wait a bit for redirects to happen
  await new Promise(resolve => setTimeout(resolve, 2000));

  if (await isLoggedIn(page)) {
    console.log("✅ Logged in via saved cookies");
    await page.screenshot({ path: "dashboard.png", fullPage: true });
    console.log("📸 Screenshot saved: dashboard.png");
  } else {
    console.log("🔁 Cookies invalid or absent — performing form login");
    await loginWithForm(page);
    
    // Navigate to dashboard after login
    if (await isLoggedIn(page)) {
      console.log("✅ Now on dashboard!");
    } else {
      console.log("⚠️  Still not on dashboard, but login may have worked");
      console.log("Attempting to navigate to dashboard...");
      await page.goto(DASHBOARD_URL, { waitUntil: "networkidle2" });
    }
    
    await page.screenshot({ path: "final-state.png", fullPage: true });
    console.log("📸 Screenshot saved: final-state.png");
  }

  console.log("\n✨ Done! Browser will stay open for 30 seconds.");
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  await browser.close();
  console.log("👋 Browser closed");
})().catch(error => {
  console.error("❌ Puppeteer test failed:", error);
  process.exit(1);
});