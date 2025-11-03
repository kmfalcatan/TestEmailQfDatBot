import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';
import ngrok from 'ngrok';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// QuoteFactory automation class
class LoadAutomationEnhanced {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.browser = null;
    this.page = null;
    this.cookiesPath = './cookies.json';
  }

  // Extract load reference from email
  extractLoadReference(emailBody) {
    const patterns = [
      /load\s*(?:reference|ref|#|number|no)?[\s:]*([A-Z0-9-]+)/i,
      /ref\s*(?:erence)?[\s:]*([A-Z0-9-]+)/i,
      /reference[\s:]*([A-Z0-9-]+)/i,
      /\b([A-Z]{2,3}\d{4,6})\b/,
      /\b(\d{5,7})\b/
    ];

    for (const pattern of patterns) {
      const match = emailBody.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  // Initialize browser
  async initialize() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });

    // Load cookies if available
    if (fs.existsSync(this.cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf8'));
      await this.page.setCookie(...cookies);
    }
  }

  // Login to QuoteFactory
  async loginToQuoteFactory() {
    await this.page.goto('https://app.quotefactory.com/', { waitUntil: 'networkidle2' });

    // Check if already logged in
    const isLoggedIn = await this.page.evaluate(() => {
      return !window.location.href.includes('login');
    });

    if (isLoggedIn) {
      console.log('✅ Already logged in (using saved session)');
      return;
    }

    // Perform login
    await this.page.waitForSelector('input[name="username"]', { timeout: 5000 });
    await this.page.type('input[name="username"]', this.username);
    await this.page.type('input[name="password"]', this.password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Save cookies
    const cookies = await this.page.cookies();
    fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
    console.log('✅ Logged in successfully and saved session');
  }

  // Search for load information
  async searchLoadInfo(loadReference) {
    await this.page.goto('https://app.quotefactory.com/loads', { waitUntil: 'networkidle2' });
    
    // Search for load
    await this.page.waitForSelector('input[type="search"]', { timeout: 5000 });
    await this.page.type('input[type="search"]', loadReference);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(2000);

    // Extract load data
    const loadInfo = await this.page.evaluate(() => {
      const data = {};
      
      // Example selectors - adjust based on actual QuoteFactory HTML
      data.pickupLocation = document.querySelector('.pickup-location')?.textContent.trim() || 'N/A';
      data.deliveryLocation = document.querySelector('.delivery-location')?.textContent.trim() || 'N/A';
      data.pickupDate = document.querySelector('.pickup-date')?.textContent.trim() || 'N/A';
      data.deliveryDate = document.querySelector('.delivery-date')?.textContent.trim() || 'N/A';
      data.equipment = document.querySelector('.equipment-type')?.textContent.trim() || 'N/A';
      data.weight = document.querySelector('.weight')?.textContent.trim() || 'N/A';
      data.commodity = document.querySelector('.commodity')?.textContent.trim() || 'N/A';
      
      return data;
    });

    return loadInfo;
  }

  // Format response email
  formatResponse(loadInfo, originalSubject, originalFrom) {
    const templates = {
      found: {
        subject: `Re: ${originalSubject}`,
        body: `Hello,

Thank you for your inquiry about load reference ${loadInfo.loadReference}.

Load Details:
- Pickup: ${loadInfo.pickupLocation} on ${loadInfo.pickupDate}
- Delivery: ${loadInfo.deliveryLocation} on ${loadInfo.deliveryDate}
- Equipment: ${loadInfo.equipment}
- Weight: ${loadInfo.weight}
- Commodity: ${loadInfo.commodity}

We'll process your quote request and get back to you shortly.

Best regards,
Harness to Go Team`
      },
      notFound: {
        subject: `Re: ${originalSubject}`,
        body: `Hello,

We received your inquiry but couldn't locate the load reference in our system. Please verify the load number and send it again.

Best regards,
Harness to Go Team`
      },
      error: {
        subject: `Re: ${originalSubject}`,
        body: `Hello,

We received your inquiry but encountered an issue processing it. Our team will review it manually and get back to you soon.

Best regards,
Harness to Go Team`
      }
    };

    return {
      responseSubject: templates.found.subject,
      responseBody: templates.found.body,
      replyTo: originalFrom
    };
  }

  // Main process method
  async processEmail(emailData) {
    try {
      const loadReference = this.extractLoadReference(emailData.body);
      
      if (!loadReference) {
        throw new Error('Load reference not found in email');
      }

      await this.initialize();
      await this.loginToQuoteFactory();
      const loadInfo = await this.searchLoadInfo(loadReference);
      loadInfo.loadReference = loadReference;

      const response = this.formatResponse(loadInfo, emailData.subject, emailData.from);

      return {
        success: true,
        loadReference,
        loadInfo,
        ...response
      };
    } catch (error) {
      console.error('Error processing email:', error);
      return {
        success: false,
        error: error.message,
        responseSubject: `Re: ${emailData.subject}`,
        responseBody: `We encountered an issue: ${error.message}`,
        replyTo: emailData.from
      };
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'QuoteFactory Webhook API',
    credentialsConfigured: !!(process.env.QUOTEFACTORY_USERNAME && process.env.QF_PASSWORD)
  });
});

app.post('/process-email', async (req, res) => {
  console.log('📧 Received webhook:', req.body);

  const { subject, body, from } = req.body;

  if (!subject || !body || !from) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: subject, body, or from'
    });
  }

  try {
    const automation = new LoadAutomationEnhanced(
      process.env.QUOTEFACTORY_USERNAME,
      process.env.QF_PASSWORD
    );

    const result = await automation.processEmail({ subject, body, from });
    res.json(result);
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`
🚀 QuoteFactory API Server Running
📍 Local webhook endpoint: http://localhost:${PORT}/process-email
💚 Health check: http://localhost:${PORT}/health
🔐 Credentials configured: ${!!(process.env.QUOTEFACTORY_USERNAME && process.env.QF_PASSWORD)}
  `);

  // Start ngrok tunnel
  try {
    const url = await ngrok.connect({
      addr: PORT,
      authtoken: process.env.NGROK_AUTHTOKEN, // optional if you already ran 'ngrok config add-authtoken ...'
    });

    console.log(`🌍 Public ngrok URL: ${url}`);
    console.log(`🔗 Webhook endpoint: ${url}/process-email`);
  } catch (error) {
    console.error("❌ Failed to start ngrok:", error);
  }
});
