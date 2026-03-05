import { chromium, Browser, Page } from "playwright";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const DEFAULT_TARGET_URL = "https://www.amazon.com/s?k=cotton+t-shirts&s=date-desc-rank";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function getFreeProxies(logCallback: (msg: string) => void): Promise<string[]> {
  logCallback("Fetching fresh free proxies for rotation...");
  try {
    // Using a public free proxy API
    const response = await fetch("https://proxylist.geonode.com/api/proxy-list?limit=20&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2chttps");
    const data = await response.json();
    const proxies = data.data.map((p: any) => `${p.protocols[0]}://${p.ip}:${p.port}`);
    logCallback(`Found ${proxies.length} potential proxies.`);
    return proxies;
  } catch (error) {
    logCallback("Failed to fetch proxy list, proceeding without proxy.");
    return [];
  }
}

async function mimicHuman(page: Page, logCallback: (msg: string) => void) {
  logCallback("Mimicking human behavior: Random mouse movements and natural scrolling...");
  
  // Natural scrolling with variable speeds
  for (let i = 0; i < 3; i++) {
    const scrollAmount = Math.floor(Math.random() * 400) + 200;
    await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
    await delay(800 + Math.random() * 1200);
  }

  // Simulated mouse movements (jittery/natural)
  await page.mouse.move(Math.random() * 500, Math.random() * 500);
  await delay(500);
  await page.mouse.move(Math.random() * 800, Math.random() * 600);
}

export async function runAmazonScraper(
  logCallback: (msg: string, type?: string) => void, 
  resultCallback: (product: any) => void,
  keyword?: string, 
  deviceType: "desktop" | "mobile" = "desktop",
  mode: "standard" | "human" | "agent" = "standard"
) {
  const targetUrl = keyword ? `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}` : DEFAULT_TARGET_URL;
  
  // Disable unstable free proxies by default as they cause ERR_TUNNEL_CONNECTION_FAILED
  // const proxies = await getFreeProxies(logCallback);
  // const selectedProxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
  const selectedProxy = null;

  let browser: Browser | null = null;
  try {
    const launchOptions: any = { 
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    };

    if (selectedProxy) {
      logCallback(`Using Proxy Rotation: ${selectedProxy}`, "info");
      launchOptions.proxy = { server: selectedProxy };
    }

    logCallback(`Launching stealth browser (${deviceType} mode)...`, "info");
    try {
      browser = await chromium.launch(launchOptions);
    } catch (error: any) {
      logCallback(`Browser launch with proxy failed: ${error.message}. Retrying without proxy...`, "warn");
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    const isMobile = deviceType === "mobile";
    const userAgent = isMobile 
      ? "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"
      : USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const context = await browser.newContext({
      userAgent,
      viewport: isMobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
      isMobile: isMobile,
      hasTouch: isMobile,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': isMobile ? '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"' : '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': isMobile ? '?1' : '?0',
        'sec-ch-ua-platform': isMobile ? '"Android"' : '"Windows"',
      }
    });

    const page: Page = await context.newPage();
    
    // Stealth: Mask webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    logCallback(`Navigating to: ${targetUrl}`, "info");
    const navTimeout = 60000; // 1 minute
    const response = await page.goto(targetUrl, { waitUntil: "load", timeout: navTimeout }).catch(err => {
      if (err.message.includes("Timeout")) {
        logCallback("Navigation timeout reached, but attempting to proceed with partial page load...", "warn");
        return null; 
      }
      // If we hit a tunnel error or other network issue, we'll throw a clearer error
      if (err.message.includes("net::")) {
        throw new Error(`CONNECTION_FAILED: Amazon is unreachable. This might be a temporary network issue or your IP is being throttled. Details: ${err.message}`);
      }
      throw err;
    });
    
    const pageTitle = await page.title();
    const pageContent = await page.content();
    
    // Specific Amazon Block Detection
    const isCaptcha = pageTitle.toLowerCase().includes("robot check") || 
                      pageTitle.toLowerCase().includes("captcha") ||
                      pageContent.includes("automated access") ||
                      pageContent.includes("api-services-support");
    
    const is503 = response?.status() === 503;
    const isAccessDenied = pageContent.includes("Access Denied") || response?.status() === 403;

    if (isCaptcha) {
      logCallback(`BLOCKED: CAPTCHA detected. Amazon is challenging the request.`, "error");
      await browser.close();
      throw new Error("CAPTCHA_DETECTED: Amazon detected automated access. Try switching to 'Android' mode or waiting a few minutes.");
    }

    if (is503) {
      logCallback(`BLOCKED: 503 Service Unavailable. Amazon is heavily throttled.`, "error");
      await browser.close();
      throw new Error("SERVICE_UNAVAILABLE: Amazon is temporarily unavailable or throttling requests. Please wait 5-10 minutes.");
    }

    if (isAccessDenied) {
      logCallback(`BLOCKED: 403 Access Denied. Your IP might be temporarily blacklisted.`, "error");
      await browser.close();
      throw new Error("ACCESS_DENIED: Amazon has blocked this connection. Try using a different keyword or switching device modes.");
    }

    logCallback("Waiting for product grid...", "info");
    
    if (mode === "agent") {
      logCallback("AI AGENT: Analyzing page structure to find the best deals...", "info");
      try {
        const pageText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `You are an expert Amazon shopping agent. Based on this page snippet, identify if there are high-quality products visible. 
          Snippet: ${pageText}
          Respond with a short 1-sentence summary of what you see and what we should look for.`,
        });
        logCallback(`AGENT REASONING: ${response.text}`, "success");
      } catch (e) {
        logCallback("Agent reasoning failed, falling back to heuristic extraction.", "warn");
      }
    }

    if (mode === "human" || mode === "agent") {
      await mimicHuman(page, (msg) => logCallback(msg, "info")).catch(() => {
        logCallback("Human mimicry failed, proceeding with standard navigation.", "warn");
      });
    }

    const foundGrid = await Promise.race([
      page.waitForSelector('div[data-component-type="s-search-result"]', { timeout: 30000 }).then(() => true),
      page.waitForSelector('.s-result-item[data-asin]', { timeout: 30000 }).then(() => true),
      page.waitForSelector('[data-asin]', { timeout: 30000 }).then(() => true)
    ]).catch(() => false);

    if (!foundGrid) {
      logCallback("Warning: Standard grid selectors not found. Checking for alternative layouts...", "warn");
    }

    // Scroll to load lazy content
    logCallback("Scrolling to trigger lazy loading...", "info");
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
    await delay(2000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
    await delay(2000);

    const finalContent = await page.content();
    const $ = cheerio.load(finalContent);
    
    // Debug: Log some info if 0 products
    const products: any[] = [];
    
    // Try multiple ways to find products
    const selectors = [
      'div[data-component-type="s-search-result"]',
      '.s-result-item[data-asin]',
      '.s-card-container',
      '[data-asin]'
    ];

    for (const selector of selectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        const asin = $el.attr('data-asin') || $el.closest('[data-asin]').attr('data-asin');
        
        if (!asin || asin.length !== 10 || products.some(p => p.asin === asin)) return;
        if ($el.find('.s-sponsored-label-text').length > 0) return;

        const title = $el.find('h2 a span').text().trim() 
                   || $el.find('.a-size-medium').text().trim()
                   || $el.find('.a-size-base-plus').text().trim()
                   || $el.find('h2').text().trim();

        const priceWhole = $el.find('.a-price-whole').first().text().replace(/[^0-9]/g, '').trim();
        const priceFraction = $el.find('.a-price-fraction').first().text().trim();
        const price = priceWhole ? `${priceWhole}.${priceFraction || '00'}` : "N/A";
        
        const ratingText = $el.find('i.a-icon-star-small span.a-icon-alt').text() 
                        || $el.find('.a-icon-star span.a-icon-alt').text();
        const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : 0;
        
        const reviewsText = $el.find('span.a-size-base.s-underline-text').text().replace(/[^0-9]/g, '')
                         || $el.find('.a-size-base').text().replace(/[^0-9]/g, '');
        const reviews = reviewsText ? parseInt(reviewsText) : 0;
        
        const relativeUrl = $el.find('h2 a').attr('href') || $el.find('a.a-link-normal').attr('href');
        const productUrl = relativeUrl ? `https://www.amazon.com${relativeUrl.split('?')[0]}` : null;

        if (asin && title && productUrl) {
          products.push({ asin, title, price, rating, reviews, productUrl });
        }
      });
      if (products.length > 0) break;
    }

    if (products.length === 0) {
      logCallback(`DIAGNOSTIC: No products found. Page Title: "${pageTitle}". Content Length: ${finalContent.length}`, "warn");
      if (finalContent.includes("sp-cc-container")) {
        logCallback("Cookie consent banner detected. Attempting to bypass...", "info");
        await page.click('#sp-cc-accept').catch(() => {});
        await delay(2000);
        // Re-run extraction logic once? No, let's just log for now.
      }
    }

    logCallback(`Successfully parsed ${products.length} unique products. Starting deep extraction...`, "success");

    const results = [];
    // Limit to first 10 for stability
    for (const product of products.slice(0, 10)) {
      let detailPage: Page | null = null;
      try {
        logCallback(`Deep Extracting ASIN: ${product.asin}`, "info");
        await delay(1000 + Math.random() * 2000);
        
        detailPage = await context.newPage();
        // Set a strict timeout for the entire product extraction
        await detailPage.goto(product.productUrl, { waitUntil: "load", timeout: 45000 }).catch(() => {
          logCallback(`Warning: Detail page for ${product.asin} timed out.`, "warn");
        });

        const detailContent = await detailPage.content();
        const $d = cheerio.load(detailContent);

        const bullets: string[] = [];
        $d('#feature-bullets ul li span.a-list-item').each((i, el) => {
          const text = $d(el).text().trim();
          if (text) bullets.push(text);
        });

        const description = $d('#productDescription').text().trim();
        
        let bsr = "N/A";
        $d('#detailBullets_feature_div li, #prodDetails tr').each((i, el) => {
          const text = $d(el).text();
          if (text.includes("Best Sellers Rank")) {
            bsr = text.split("Best Sellers Rank:")[1]?.split("(")[0]?.trim() || text.trim();
          }
        });

        const category = $d('#wayfinding-breadcrumbs_container ul li:last-child').text().trim() || "N/A";
        const seller = $d('#merchant-info').text().trim() || "Amazon.com";

        const extractedProduct = {
          ...product,
          bullets,
          description,
          bestSellerRank: bsr,
          category,
          sellerName: seller
        };
        results.push(extractedProduct);
        resultCallback(extractedProduct);
        logCallback(`SUCCESS: Extracted details for ${product.asin}`, "success");
      } catch (err: any) {
        logCallback(`FAILED: ASIN ${product.asin} - ${err.message}`, "warn");
      } finally {
        if (detailPage) await detailPage.close().catch(() => {});
      }
    }

    logCallback(`Extraction Complete. ${results.length} products processed.`, "success");
    return results;
  } catch (error: any) {
    logCallback(`CRITICAL ERROR: ${error.message}`, "error");
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
