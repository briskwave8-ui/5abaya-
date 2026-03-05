import json
import random
import asyncio
import logging
import re
from playwright.async_api import async_playwright
from selectolax.lexbor import LexborHTML
from fake_useragent import UserAgent

# Configure Production Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [AUDITOR] - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

TARGET_URL = "https://www.amazon.com/s?bbn=12035955011&i=fashion-novelty&oq=Solid%20colors%3A%20100%25%2BCotton%3B%20Heather%20Grey%3A%2090%25%2BCotton%2C%2010%25%2BPolyester%3B%20All%20Other%20Heathers%3A%2050%25%2BCotton%2C%2050%25%2BPolyester%20Lightweight%2C%20Classic%20fit%2C%20Double-needle%20sleeve%20and%20bottom%20hem%20Machine%20wash%20cold%20with%20like%20colors%2C%20dry%20low%20heat%20-long%20-premium%20-sweatshirt%20-v-neck%20-tank%2010%20x%208%20x%201%20inches%3B%204.8%20Ounces&qid=1699392328&ref=glow_cls&refresh=1&rh=p_6%3AATVPDKIKX0DER&s=date-desc-rank"

class AmazonScraperAudit:
    def __init__(self):
        self.ua = UserAgent()
        self.results = []
        self.stats = {
            "total_found": 0,
            "success": 0,
            "failed": 0,
            "skipped_sponsored": 0,
            "captcha_detected": 0
        }

    async def block_resources(self, route):
        """Optimizes speed and reduces footprint by blocking unnecessary resources."""
        if route.request.resource_type in ["image", "font", "media"]:
            await route.abort()
        else:
            await route.continue_()

    async def get_page_content(self, page, url, retries=2):
        """Robust navigation with smart retries and anti-bot detection."""
        for attempt in range(retries + 1):
            try:
                await asyncio.sleep(random.uniform(2, 5))
                response = await page.goto(url, wait_until="networkidle", timeout=90000)
                
                # Handle "Select your address" popup
                try:
                    address_btn = await page.query_selector('input[data-action-type="SELECT_LOCATION"]')
                    if address_btn:
                        await address_btn.click(timeout=5000)
                        await asyncio.sleep(2)
                except: pass

                title = (await page.title()).lower()
                if response.status == 503 or "robot check" in title or "captcha" in title:
                    logger.warning(f"Blocked by Amazon (503/Captcha) on attempt {attempt + 1}")
                    self.stats["captcha_detected"] += 1
                    continue
                
                if response.status != 200:
                    logger.warning(f"Non-200 status code: {response.status} for {url}")
                    continue

                # Scroll to trigger lazy loading
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
                await asyncio.sleep(2)

                return await page.content()
            except Exception as e:
                logger.error(f"Attempt {attempt + 1} failed for {url}: {str(e)}")
                if attempt == retries:
                    return None
        return None

    def parse_search_results(self, html):
        """Validates and extracts search result data with broad selector support."""
        tree = LexborHTML(html)
        
        # Broadest possible search result detection
        search_results = tree.css('[data-asin]')
        
        if not search_results:
            logger.warning("DEBUG: No search results found with broad selectors.")
            return []

        products = []
        seen_asins = set()

        for result in search_results:
            asin = result.attributes.get('data-asin')
            if not asin or len(asin) != 10 or asin in seen_asins:
                continue

            # Filter Sponsored
            if result.css_first('.s-sponsored-label-text') or \
               result.css_first('.s-label-popover-default') or \
               "Sponsored" in result.text():
                self.stats["skipped_sponsored"] += 1
                continue

            title_node = result.css_first('h2 a span') or \
                         result.css_first('.a-size-medium') or \
                         result.css_first('.a-size-base-plus') or \
                         result.css_first('h2')
            title = title_node.text().strip() if title_node else "N/A"

            # Improved Price Parsing
            price_whole = result.css_first('.a-price-whole')
            price_fraction = result.css_first('.a-price-fraction')
            if price_whole:
                price = f"{price_whole.text().strip().replace(',', '').replace('.', '')}.{price_fraction.text().strip() if price_fraction else '00'}"
            else:
                price = "N/A"

            # Numeric Rating
            rating_node = result.css_first('i.a-icon-star-small span.a-icon-alt') or \
                          result.css_first('.a-icon-star span.a-icon-alt') or \
                          result.css_first('.a-star-small')
            rating = 0.0
            if rating_node:
                try:
                    rating = float(rating_node.text().split(' ')[0])
                except:
                    pass

            # Integer Review Count
            reviews_node = result.css_first('span.a-size-base.s-underline-text') or \
                           result.css_first('.a-size-small .a-link-normal')
            reviews = 0
            if reviews_node:
                try:
                    reviews = int(''.join(filter(str.isdigit, reviews_node.text())))
                except:
                    pass

            # Absolute URL
            url_node = result.css_first('h2 a') or result.css_first('a.a-link-normal')
            product_url = f"https://www.amazon.com{url_node.attributes.get('href').split('?')[0]}" if url_node else ""

            if asin and product_url:
                seen_asins.add(asin)
                products.append({
                    "asin": asin,
                    "title": title,
                    "price": price,
                    "rating": rating,
                    "reviews": reviews,
                    "productUrl": product_url
                })
        
        return products

    def parse_product_details(self, html):
        """Validates and extracts product detail page data."""
        tree = LexborHTML(html)
        
        # Bullet points
        bullets = [node.text().strip() for node in tree.css("#feature-bullets ul li span.a-list-item") if node.text().strip()]
        
        # Description
        desc_node = tree.css_first("#productDescription")
        description = desc_node.text().strip() if desc_node else ""
        
        # Best Seller Rank (Robust Regex)
        bsr = "N/A"
        # Check multiple containers where BSR might hide
        containers = ["#detailBullets_feature_div", "#prodDetails", ".a-keyvalue"]
        for selector in containers:
            node = tree.css_first(selector)
            if node:
                text = node.text()
                if "Best Sellers Rank" in text:
                    match = re.search(r'Best Sellers Rank:\s*(.*?)(?:\s*in|$)', text, re.DOTALL)
                    if match:
                        bsr = match.group(1).strip()
                        break

        # Category (Breadcrumbs)
        cat_nodes = tree.css("#wayfinding-breadcrumbs_container ul li span.a-list-item a")
        category = cat_nodes[-1].text().strip() if cat_nodes else "N/A"
        
        # Seller Name (Multiple Fallbacks)
        seller = "Amazon.com"
        seller_node = tree.css_first("#merchant-info")
        if seller_node:
            seller = seller_node.text().strip()
        else:
            buybox_seller = tree.css_first("#tabular-buybox .tabular-buybox-text")
            if buybox_seller:
                seller = buybox_seller.text().strip()

        return {
            "bullets": bullets,
            "description": description,
            "bestSellerRank": bsr,
            "category": category,
            "sellerName": seller
        }

    async def run(self):
        async with async_playwright() as p:
            # Graceful Launch with Error Handling
            try:
                browser = await p.chromium.launch(headless=True)
            except Exception as e:
                logger.error(f"CRITICAL: Failed to launch browser: {str(e)}")
                return

            # Browser Context Isolation
            context = await browser.new_context(
                user_agent=self.ua.random,
                viewport={'width': 1920, 'height': 1080},
                java_script_enabled=True
            )
            
            page = await context.new_page()
            # Resource Blocking for speed
            await page.route("**/*", self.block_resources)

            logger.info(f"Navigating to Search Page: {TARGET_URL}")
            search_html = await self.get_page_content(page, TARGET_URL)
            
            if not search_html:
                logger.error("Failed to load search results page after retries.")
                await browser.close()
                return

            products = self.parse_search_results(search_html)
            self.stats["total_found"] = len(products)
            logger.info(f"Found {len(products)} valid products. Starting detail extraction...")

            for item in products[:10]: # Audit limit
                logger.info(f"Extracting details for ASIN: {item['asin']}")
                try:
                    detail_html = await self.get_page_content(page, item['productUrl'])
                    
                    if detail_html:
                        details = self.parse_product_details(detail_html)
                        self.results.append({**item, **details})
                        self.stats["success"] += 1
                        logger.info(f"SUCCESS: Extracted ASIN {item['asin']} successfully.")
                    else:
                        self.stats["failed"] += 1
                        logger.error(f"ERROR: Failed to load detail page for ASIN {item['asin']}.")
                except Exception as e:
                    self.stats["failed"] += 1
                    logger.error(f"ERROR: Exception while processing ASIN {item['asin']}: {str(e)}")

            # Clean JSON Writer
            try:
                with open("amazon_extracted_data.json", "w", encoding="utf-8") as f:
                    json.dump(self.results, f, indent=4, ensure_ascii=False)
                logger.info("SUCCESS: Data saved to amazon_extracted_data.json")
            except Exception as e:
                logger.error(f"ERROR: Failed to save data: {str(e)}")

            logger.info(f"Audit Complete. Summary: {self.stats['success']} succeeded, {self.stats['failed']} failed, {self.stats['skipped_sponsored']} skipped.")
            await browser.close()

if __name__ == "__main__":
    audit_scraper = AmazonScraperAudit()
    asyncio.run(audit_scraper.run())
