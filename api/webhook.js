// api/webhook.js - Fixed Puppeteer with Enhanced Data Extraction
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';


class LoadAutomationEnhanced {
    constructor() {
        this.browser = null;
        this.page = null;
    }


    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    async initialize() {
        try {
            console.log('🚀 Initializing browser for QuoteFactory...');
           
            // Strategy 1: Use Browserless.io service (RECOMMENDED for Vercel)
            if (process.env.BROWSERLESS_TOKEN) {
                console.log('🌐 Using Browserless.io service...');
                try {
                    this.browser = await puppeteer.connect({
                        browserWSEndpoint: `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`,
                    });
                    console.log('✅ Connected to Browserless.io successfully');
                } catch (browserlessError) {
                    console.log('❌ Browserless.io failed:', browserlessError.message);
                    console.log('💡 Please check your token at https://www.browserless.io/');
                }
            } else {
                console.log('⚠️ No BROWSERLESS_TOKEN found - browser automation may fail on Vercel');
                console.log('💡 Get free token from https://www.browserless.io/');
            }
           
            // Strategy 2: Try local chromium if no browser yet
            if (!this.browser) {
                console.log('🔧 Attempting local chromium (may fail on serverless)...');
                const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
               
                if (isServerless) {
                    console.log('⚠️ WARNING: Running in serverless environment without Browserless.io');
                    console.log('⚠️ This will likely fail due to missing system libraries');
                    throw new Error('Browser automation requires Browserless.io token in serverless environments. Please add BROWSERLESS_TOKEN to environment variables.');
                }
               
                // Local development only
                console.log('💻 Using local Chrome installation...');
                const launchOptions = {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                };
               
                this.browser = await puppeteer.launch(launchOptions);
            }
           
            this.page = await this.browser.newPage();
           
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
           
            // Block heavy resources to save memory and time
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
                const url = req.url();
                const resourceType = req.resourceType();
               
                if (url.includes('quotefactory.com') || url.includes('auth0.com')) {
                    req.continue();
                } else if (['image', 'font', 'stylesheet'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
           
            console.log('✅ Browser initialized successfully');
            return true;
           
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error);
            return false;
        }
    }


    async cleanup() {
        try {
            if (this.page) await this.page.close();
            if (this.browser) await this.browser.close();
            console.log('✅ Browser cleanup completed');
        } catch (error) {
            console.error('❌ Cleanup error:', error);
        }
    }


    extractLoadReference(emailBody) {
        const exclusionPatterns = [
            /MC\s*\d+/i,
            /DOT\s*\d+/i,
            /USDOT\s*\d+/i,
            /invoice\s*#?\s*\d+/i,
            /bill\s*#?\s*\d+/i
        ];
       
        for (const pattern of exclusionPatterns) {
            const match = emailBody.match(pattern);
            if (match) {
                console.log(`❌ Found exclusion pattern: ${match[0]} - ignoring`);
                emailBody = emailBody.replace(pattern, '');
            }
        }
       
        const patterns = [
            /order\s*#?\s*(\d{6,8})/i,
            /reference\s+number\s+(\d{6,8})/i,
            /ref[:\s]+(\d{6,8})/i,
            /\b(\d{6})\b/i,
            /(?:load\s*(?:ref|reference|number|id|#)[:\-\s]*)([A-Z0-9\-\_]+)/i,
            /([A-Z]{2,4}[\-\_\s]*\d{3,8}[\-\_\s]*[A-Z0-9]*)/i,
            /([A-HJ-Z]+\d{4,8}[A-Z0-9]*)/i
        ];
       
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = emailBody.match(pattern);
           
            if (match && match[1]) {
                let cleanMatch = match[1].trim();
                cleanMatch = cleanMatch.replace(/[^\w\-]/g, '');
               
                if (cleanMatch &&
                    cleanMatch.length >= 4 &&
                    !cleanMatch.toUpperCase().startsWith('MC') &&
                    !cleanMatch.toUpperCase().startsWith('DOT')) {
                   
                    return cleanMatch;
                }
            }
        }
       
        console.log('❌ No valid load reference found');
        return null;
    }


    async loginToQuoteFactory() {
        try {
            console.log('🔐 Starting QuoteFactory login...');
           
            const username = process.env.QF_USERNAME;
            const password = process.env.QF_PASSWORD;
           
            if (!username || !password) {
                console.log('❌ No QuoteFactory credentials found');
                return false;
            }
           
            this.page.setDefaultTimeout(15000);
            this.page.setDefaultNavigationTimeout(15000);
           
            await this.page.goto('https://app.quotefactory.com', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
           
            console.log('Current URL:', this.page.url());
           
            if (this.page.url().includes('/broker/dashboard')) {
                console.log('✅ Already on dashboard!');
                return true;
            }
           
            console.log('🔄 Need to perform login...');
            await this.wait(500);
           
            try {
                let loginSuccess = false;
               
                // Method 1: Direct form fields
                try {
                    await this.page.waitForSelector('input[type="email"], input[name="username"]', { timeout: 10000 });
                    const emailField = await this.page.$('input[type="email"], input[name="username"]');
                    const passwordField = await this.page.$('input[type="password"]');
                   
                    if (emailField && passwordField) {
                        console.log('📝 Filling credentials...');
                        await emailField.type(username, { delay: 10 });
                        await passwordField.type(password, { delay: 10 });
                        await this.page.keyboard.press('Enter');
                        loginSuccess = true;
                    }
                } catch (e) {
                    console.log('⚠️ Direct form method failed:', e.message);
                }
               
                // Method 2: Auth0 iframe (simplified for Puppeteer)
                if (!loginSuccess) {
                    try {
                        console.log('🔍 Trying Auth0 iframe...');
                        const frames = await this.page.frames();
                       
                        for (const frame of frames) {
                            const frameUrl = frame.url();
                            if (frameUrl.includes('auth0.com')) {
                                console.log('Found Auth0 frame:', frameUrl);
                               
                                await frame.waitForSelector('input[type="email"], input[name="username"]', { timeout: 5000 });
                                const emailField = await frame.$('input[type="email"], input[name="username"]');
                                const passwordField = await frame.$('input[type="password"]');
                               
                                if (emailField && passwordField) {
                                    await emailField.type(username, { delay: 10 });
                                    await passwordField.type(password, { delay: 10 });
                                    await frame.keyboard.press('Enter');
                                    loginSuccess = true;
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        console.log('⚠️ Auth0 iframe method failed:', e.message);
                    }
                }
               
                if (!loginSuccess) {
                    console.log('❌ All login methods failed');
                    return false;
                }
               
                console.log('⏳ Waiting for login to complete...');
               
                // Wait for OAuth callback redirect to complete
                try {
                    await this.page.waitForFunction(
                        () => window.location.href.includes('/broker/dashboard') || window.location.href.includes('/dashboard'),
                        { timeout: 2000 }
                    );
                    console.log('✅ Login successful!');
                    return true;
                } catch (timeoutError) {
                    const currentUrl = this.page.url();
                    console.log('Post-login URL:', currentUrl);
                   
                    // If we're on the auth callback, wait a bit more for redirect
                    if (currentUrl.includes('/auth?code=')) {
                        console.log('⏳ On OAuth callback, waiting for redirect...');
                        await this.wait(3000);
                       
                        const finalUrl = this.page.url();
                        if (finalUrl.includes('/broker/dashboard') || finalUrl.includes('/dashboard')) {
                            console.log('✅ Login successful after redirect!');
                            return true;
                        }
                    }
                   
                    console.log('❌ Login may have failed - not on dashboard');
                    return false;
                }
               
            } catch (loginError) {
                console.log('❌ Login process failed:', loginError.message);
                return false;
            }
           
        } catch (error) {
            console.error('❌ QuoteFactory login failed:', error.message);
            return false;
        }
    }


    async searchLoadInfo(loadReference) {
        try {
            console.log(`\n🔎 Searching for load reference: ${loadReference}`);
           
            // Step 1: Click search button to open search
            console.log("⌨️  Opening search by clicking button...");
           
            let searchFieldFound = false;
            try {
                await this.page.evaluate(() => {
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
                await this.wait(1500);
                await this.page.waitForSelector('#search_field', { timeout: 5000 });
                searchFieldFound = true;
                console.log("✅ Search field appeared!");
            } catch (err) {
                console.log("❌ Could not open search");
            }
           
            if (!searchFieldFound) {
                console.log('❌ Search field not found');
                return null;
            }
           
            console.log("✅ Search field is ready!");
           
            // Step 3: Type the reference
            console.log(`⌨️  Typing load reference: ${loadReference}`);
            await this.page.click('#search_field', { clickCount: 3 });
            await this.page.type('#search_field', loadReference, { delay: 50 });
            console.log(`✅ Typed: ${loadReference}`);
           
            // Step 4: Press Enter
            console.log("⏎ Pressing Enter to search...");
            await this.page.keyboard.press('Enter');
            console.log("✅ Enter pressed");
           
            // Step 5: Wait for results to load
            console.log("⏳ Waiting for search results to load...");
            await this.wait(8000);
           
            // Click on search result
            await this.page.evaluate(() => {
                ['.\\@container a[data-current="true"]', '.\\@container a', '.\\@container'].some(sel => {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return true; }
                });
            });
            await this.wait(5000);
           
            // Step 6: Extract load info with enhanced extraction
            console.log("📊 Extracting load details...");
            const loadInfo = await this.extractLoadDetailsFromPage();
           
            if (loadInfo && (loadInfo.loadReference !== "N/A" || loadInfo.pickup !== "N/A" || loadInfo.delivery !== "N/A")) {
                console.log("✅ Load data extracted successfully");
                return loadInfo;
            } else {
                console.log("⚠️ No load data found");
                return null;
            }
           
        } catch (error) {
            console.error('❌ Load search failed:', error.message);
            return null;
        }
    }


    async extractLoadDetailsFromPage() {
        return await this.page.evaluate(() => {
            const text = document.body.innerText;
           
            // Extract BOL/Load Reference
            const bolMatch = text.match(/BOL[\s\n]+(\d+)/i);
            const loadReference = bolMatch ? bolMatch[1] : "N/A";
           
            // Extract Rate from specific styled div
            let rate = "N/A";
            const priceDiv = document.querySelector('.text-right.py-2.font-bold.order-last.px-3');
            if (priceDiv) {
                const m = priceDiv.textContent.match(/\$[\d,]+\.?\d*/);
                if (m) rate = m[0];
            }
           
            // Extract Weight
            let weight = "N/A";
            const weightDiv = Array.from(document.querySelectorAll("div")).find(d => d.textContent.trim() === "Weight");
            if (weightDiv) {
                const val = weightDiv.closest(".flex")?.querySelector("div.font-semibold, .text-12, .text-15");
                if (val) {
                    const txt = val.textContent.replace(/\u202F/g, "").trim();
                    weight = txt.match(/lb/i) ? txt : `${txt} lb`;
                }
            }
           
            // Extract Commodity
            let commodity = "N/A";
            const commDiv = Array.from(document.querySelectorAll("div.text-black-100.text-12.pt-1.flex.items-baseline")).find(d => d.querySelector("div.font-semibold"));
            if (commDiv) {
                const strong = commDiv.querySelector("div.font-semibold")?.textContent.trim() || "";
                commodity = strong.replace(/&nbsp;/g, '').trim();
            }
           
            // Helper function to convert "4:25am" or "12:45pm" → "0425" or "1245"
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


                const timeContainers = Array.from(loc.querySelectorAll('div.text-14'));
                let dateTime = "N/A";


                const timeContainer = timeContainers.find(container => container.querySelector('time'));


                if (timeContainer) {
                    const times = timeContainer.querySelectorAll('time');


                    if (times.length >= 2) {
                        // Time range (e.g., "9:00am - 6:00pm")
                        const startTime = toMilitaryNoColon(times[0].textContent.trim());
                        const endTime = toMilitaryNoColon(times[1].textContent.trim());


                        const datetimeAttr = times[0].getAttribute('datetime');
                        if (datetimeAttr) {
                            const d = new Date(datetimeAttr);
                            const mo = String(d.getMonth() + 1).padStart(2, '0');
                            const day = String(d.getDate()).padStart(2, '0');
                            dateTime = `${mo}/${day} ${startTime}-${endTime}`;
                        } else {
                            dateTime = `${startTime}-${endTime}`;
                        }
                    } else if (times.length === 1) {
                        // Single time (e.g., "4:28pm")
                        const time = toMilitaryNoColon(times[0].textContent.trim());
                        const datetimeAttr = times[0].getAttribute('datetime');
                        if (datetimeAttr) {
                            const d = new Date(datetimeAttr);
                            const mo = String(d.getMonth() + 1).padStart(2, '0');
                            const day = String(d.getDate()).padStart(2, '0');
                            dateTime = `${mo}/${day} ${time}`;
                        } else {
                            dateTime = `${time}`;
                        }
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
    }


    formatResponse(loadReference, loadInfo, subject, originalEmail) {
        if (loadInfo && loadInfo.pickup !== "N/A") {
            return {
                subject: `Re: ${subject}`,
                body: `Hello,


Thank you for your inquiry about load ${loadReference}. Here are the details:


📦 LOAD DETAILS:
${loadInfo.pickup}
${loadInfo.delivery}
Weight: ${loadInfo.weight}
Commodity: ${loadInfo.commodity}
Rate: ${loadInfo.rate}


🚛 CAPACITY INQUIRY:
When and where will you be empty for pickup?


Best regards,
Balto Booking


---
Automated response with live QuoteFactory data`
            };
        } else if (loadReference) {
            return {
                subject: `Re: ${subject}`,
                body: `Hello,


We encountered an issue retrieving details for load reference **${loadReference}** from QuoteFactory.

⚠️ Possible reasons:
• The load number may not exist or is no longer active  
• There was a temporary system error while accessing QuoteFactory

Our team has been notified and will review this manually.

Best regards,  
Balto Booking

---
Automated notification - QuoteFactory load fetch error`
            };
        } else {
            return {
                subject: `Re: ${subject} - DAT Reference Number Needed`,
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
    }
}


export { LoadAutomationEnhanced };


// VERCEL SERVERLESS HANDLER
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }


    const automation = new LoadAutomationEnhanced();
   
    try {
        console.log('=== Processing Email with Fixed Puppeteer Integration ===');
        console.log('Full request body:', JSON.stringify(req.body, null, 2));
        console.log('Subject:', req.body.subject);
        console.log('Body Preview:', req.body.bodyPreview?.substring(0, 200));
       
        // Handle Zapier's data format - all data comes in req.body.JSON
        const zapierData = req.body.JSON || '';
        const emailId = req.body.id || 'unknown';
        const subject = req.body.subject || 'Load Inquiry';
        const bodyPreview = req.body.bodyPreview || '';
        const emailBodyContent = req.body.body?.content || '';
       
        // Use Zapier data if available, otherwise fall back to structured data
        const emailContent = zapierData || bodyPreview || emailBodyContent || '';
       
        const loadReference = automation.extractLoadReference(emailContent);
       
        let loadInfo = null;
        let hasCredentials = false;
       
        if (loadReference) {
            hasCredentials = process.env.QF_USERNAME && process.env.QF_PASSWORD;
           
            if (hasCredentials) {
                console.log('🔐 Credentials found, attempting QuoteFactory lookup...');
               
                const browserReady = await automation.initialize();
                if (browserReady) {
                    const loginSuccess = await automation.loginToQuoteFactory();
                    if (loginSuccess) {
                        loadInfo = await automation.searchLoadInfo(loadReference);
                    }
                    await automation.cleanup();
                } else {
                    console.log('❌ Browser initialization failed - using intelligent fallback response');
                    console.log('🔍 Attempting HTTP-based QuoteFactory check...');
                   
                    // Try a simple HTTP check to see if load exists
                    try {
                        const response = await fetch(`https://app.quotefactory.com/api/shipment/search?q=${loadReference}`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            timeout: 5000
                        });
                       
                        if (response.ok) {
                            console.log('✅ Load exists in QuoteFactory (HTTP check)');
                        }
                    } catch (error) {
                        console.log('ℹ️ HTTP check failed, using standard fallback');
                    }
                }
            } else {
                console.log('⚠️ No QuoteFactory credentials - using basic response');
            }
        }
       
        const responseEmail = automation.formatResponse(loadReference, loadInfo, subject, emailContent);
       
        return res.status(200).json({
            success: true,
            loadReference: loadReference || null,
            loadInfo: loadInfo || null,
            responseSubject: responseEmail.subject,
            responseBody: responseEmail.body,
            quotefactoryAttempted: !!(loadReference && hasCredentials),
            quotefactorySuccess: !!(loadInfo && loadInfo.pickup !== "N/A"),
            replyToEmailId: emailId,
            timestamp: new Date().toISOString(),
            mode: 'puppeteer-enhanced'
        });
       
    } catch (error) {
        console.error('❌ Webhook error:', error);
       
        await automation.cleanup();
       
        return res.status(200).json({
            success: true,
            message: 'Error processing - fallback response',
            responseSubject: 'Re: Load Inquiry',
            responseBody: 'Thank you for your email. We are processing your inquiry and will respond shortly.',
            timestamp: new Date().toISOString()
        });
    }
}


export const config = {
    maxDuration: 30,
};



