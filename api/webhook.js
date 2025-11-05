// api/webhook.js - Combined with testPuppeteer login and extraction
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class LoadAutomationEnhanced {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async initialize() {
        try {
            console.log('🚀 Initializing browser...');
            
            if (process.env.BROWSERLESS_TOKEN) {
                console.log('🌐 Using Browserless.io...');
                try {
                    this.browser = await puppeteer.connect({
                        browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`,
                    });
                } catch (err) {
                    console.log('❌ Browserless.io failed, using local chromium');
                }
            }
            
            if (!this.browser) {
                const isLocal = !!process.env.CHROME_BIN || !!process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
                const launchOptions = isLocal ? {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                } : {
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                };
                this.browser = await puppeteer.launch(launchOptions);
            }
            
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            console.log('✅ Browser initialized');
            return true;
        } catch (error) {
            console.error('❌ Browser init failed:', error);
            return false;
        }
    }

    async cleanup() {
        try {
            if (this.page) await this.page.close();
            if (this.browser) await this.browser.close();
            console.log('✅ Cleanup completed');
        } catch (error) {
            console.error('❌ Cleanup error:', error);
        }
    }

    async findVisible(selectors) {
        for (const sel of selectors) {
            try {
                const el = await this.page.$(sel);
                if (el && await this.page.evaluate(e => getComputedStyle(e).display !== 'none', el)) return sel;
            } catch {}
        }
        return null;
    }

    async isLoggedIn() {
        if (this.page.url().includes('auth.quotefactory.com')) return false;
        if (this.page.url().includes('app.quotefactory.com')) {
            await wait(2000);
            return this.page.evaluate(() => !!(document.querySelector('nav, header, button') || document.body.textContent.includes('find')));
        }
        return false;
    }

    async loginToQuoteFactory() {
        try {
            console.log('🔐 Logging in to QuoteFactory...');
            
            const username = process.env.QUOTEFACTORY_USERNAME;
            const password = process.env.QUOTEFACTORY_PASSWORD;
            
            if (!username || !password) {
                console.log('❌ No credentials');
                return false;
            }

            try {
                await this.page.goto('https://app.quotefactory.com', { waitUntil: "networkidle2", timeout: 90000 });
            } catch {}
            
            await wait(8000);
            
            if (await this.isLoggedIn()) {
                console.log('✅ Already logged in');
                return true;
            }

            try {
                await this.page.waitForSelector('.auth0-lock-widget', { timeout: 10000 });
                await wait(5000);
            } catch {
                await this.page.waitForFunction(() => 
                    document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2,
                    { timeout: 60000 }
                );
            }

            const emailSel = await this.findVisible(['input[type="email"]', 'input[name="email"]', 'input[name="username"]']);
            if (!emailSel) throw new Error("Email input not found");
            
            await this.page.click(emailSel, { clickCount: 3 });
            await wait(500);
            await this.page.type(emailSel, username, { delay: 100 });
            await wait(1500);

            const passSel = await this.findVisible(['input[type="password"]', 'input[name="password"]']);
            if (!passSel) throw new Error("Password input not found");
            
            await this.page.click(passSel, { clickCount: 3 });
            await wait(500);
            await this.page.type(passSel, password, { delay: 100 });
            await wait(1500);

            let submitSel = await this.findVisible(['button[type="submit"]', 'button[name="submit"]', '.auth0-lock-submit']);
            if (!submitSel) {
                submitSel = await this.page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => /log in|sign in|continue/i.test(b.textContent));
                    if (btn) { btn.setAttribute('data-submit', '1'); return '[data-submit="1"]'; }
                    return null;
                });
            }
            if (!submitSel) throw new Error("Submit button not found");

            await this.page.click(submitSel);
            try { await this.page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle2' }); } catch {}
            await wait(5000);
            
            const loggedIn = await this.isLoggedIn();
            if (loggedIn) {
                console.log('✅ Login successful');
                return true;
            }
            
            console.log('❌ Login failed');
            return false;
        } catch (error) {
            console.error('❌ Login error:', error.message);
            return false;
        }
    }

    async searchLoadInfo(loadReference) {
        try {
            console.log(`🔍 Searching for load: ${loadReference}`);
            
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('KeyK');
            await this.page.keyboard.up('Control');
            await wait(2000);

            try {
                await this.page.waitForSelector('#search_field', { timeout: 5000 });
            } catch {
                await this.page.evaluate(() => 
                    Array.from(document.querySelectorAll('button')).find(b => /find|anything/i.test(b.textContent))?.click()
                );
                await wait(2000);
                await this.page.waitForSelector('#search_field', { timeout: 5000 });
            }

            await this.page.click('#search_field', { clickCount: 3 });
            await this.page.type('#search_field', loadReference, { delay: 100 });
            await this.page.keyboard.press('Enter');
            await wait(8000);

            await this.page.evaluate(() => {
                ['.\\@container a[data-current="true"]', '.\\@container a', '.\\@container'].some(sel => {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return true; }
                });
            });
            await wait(5000);

            const loadData = await this.page.evaluate(() => {
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

            const hasCompleteData = loadData?.loadReference !== "N/A" && loadData?.pickup !== "N/A" && loadData?.delivery !== "N/A";
            
            if (hasCompleteData) {
                console.log('✅ Load data found');
                return loadData;
            }
            
            console.log('⚠️ Incomplete data');
            return null;
        } catch (error) {
            console.error('❌ Search failed:', error.message);
            return null;
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
                console.log(`❌ Exclusion: ${match[0]}`);
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
        
        console.log('🔍 Searching for load reference...');
        
        for (const pattern of patterns) {
            const match = emailBody.match(pattern);
            if (match && match[1]) {
                let cleanMatch = match[1].trim().replace(/[^\w\-]/g, '');
                if (cleanMatch && cleanMatch.length >= 4 && 
                    !cleanMatch.toUpperCase().startsWith('MC') &&
                    !cleanMatch.toUpperCase().startsWith('DOT')) {
                    console.log(`✅ Found: ${cleanMatch}`);
                    return cleanMatch;
                }
            }
        }
        
        console.log('❌ No load reference found');
        return null;
    }

    formatResponse(loadReference, loadInfo, subject) {
        if (loadInfo) {
            return {
                subject: `Re: ${subject} - Complete Details`,
                body: `Hello,

Thank you for your inquiry about load ${loadInfo.loadReference}. Here are the details:

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

Thank you for your inquiry regarding load ${loadReference}.

I've identified this load reference and am currently pulling the complete details from our system. You'll receive:

📦 LOAD INFORMATION:
• Pickup and delivery locations with dates/times  
• Commodity details and weight requirements
• Our competitive rate quote
• Equipment specifications
• Any special handling requirements

This detailed information will be sent within the next 10-15 minutes via our load management team.

🚛 TO EXPEDITE: When and where will you be empty for pickup?

We're ready to provide immediate quotes and book qualified loads on the spot.

Best regards,
Balto Booking

---
Professional freight services with real-time load tracking`
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
        console.log('=== Processing Email ===');
        
        const zapierData = req.body.JSON || '';
        const emailId = req.body.id || 'unknown';
        const subject = req.body.subject || 'Load Inquiry';
        const bodyPreview = req.body.bodyPreview || '';
        const emailBodyContent = req.body.body?.content || '';
        
        const emailContent = zapierData || bodyPreview || emailBodyContent || '';
        
        const loadReference = automation.extractLoadReference(emailContent);
        
        let loadInfo = null;
        let hasCredentials = false;
        
        if (loadReference) {
            console.log(`✅ Found load: ${loadReference}`);
            
            hasCredentials = process.env.QUOTEFACTORY_USERNAME && process.env.QUOTEFACTORY_PASSWORD;
            
            if (hasCredentials) {
                console.log('🔐 Attempting QuoteFactory lookup...');
                
                const browserReady = await automation.initialize();
                if (browserReady) {
                    const loginSuccess = await automation.loginToQuoteFactory();
                    if (loginSuccess) {
                        loadInfo = await automation.searchLoadInfo(loadReference);
                    }
                    await automation.cleanup();
                }
            }
        }
        
        const responseEmail = automation.formatResponse(loadReference, loadInfo, subject);
        
        return res.status(200).json({
            success: true,
            loadReference: loadReference || null,
            loadInfo: loadInfo || null,
            responseSubject: responseEmail.subject,
            responseBody: responseEmail.body,
            quotefactoryAttempted: !!(loadReference && hasCredentials),
            quotefactorySuccess: !!(loadInfo),
            replyToEmailId: emailId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        await automation.cleanup();
        
        return res.status(200).json({
            success: true,
            message: 'Error - fallback response',
            responseSubject: 'Re: Load Inquiry',
            responseBody: 'Thank you for your email. We are processing your inquiry and will respond shortly.',
            timestamp: new Date().toISOString()
        });
    }
}

export const config = {
    maxDuration: 60,
};