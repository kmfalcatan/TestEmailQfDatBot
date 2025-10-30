import { LoadAutomationEnhanced } from './api/webhook.js';

const automation = new LoadAutomationEnhanced();

(async () => {
  console.log('🚀 Starting QuoteFactory login + test search...');
  const ready = await automation.initialize();

  if (ready) {
    const login = await automation.loginToQuoteFactory();
    if (login) {
      const testLoad = '1234567'; // any load ID you have in QF
      const info = await automation.searchLoadInfo(testLoad);
      console.log('✅ Load Info:', info);
    } else {
      console.log('❌ Login failed');
    }
  }

  await automation.cleanup();
})();