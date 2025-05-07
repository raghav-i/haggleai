import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse 
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI, OpenAIError
from dotenv import load_dotenv
import logging
from typing import Dict, List, Optional
import aiohttp
import re
import json
from bs4 import BeautifulSoup
import asyncio


load_dotenv() 

API_KEY = os.getenv("OPENROUTER_API_KEY", "<YOUR KEY HERE>") 
MODEL_NAME = "deepseek/deepseek-chat-v3-0324:free" 

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


app = FastAPI(title="haggle.ai Chatbot API")

@app.get("/style.css", include_in_schema=False)
async def get_style():
    return FileResponse("style.css", media_type="text/css")

@app.get("/script.js", include_in_schema=False)
async def get_script():
    return FileResponse("script.js", media_type="application/javascript")

try:
    if not os.path.exists("static"):
        os.makedirs("static")
        logger.info("Created static directory.")
    
    app.mount("/static", StaticFiles(directory="static"), name="static")
except Exception as e:
    logger.error(f"Failed to mount static directory: {e}. Ensure 'static' folder exists.")


session_histories: Dict[str, List[Dict[str, str]]] = {}



if not API_KEY or API_KEY == "<YOUR KEY HERE>":
    logger.warning("OpenRouter API key not set. Please set the OPENROUTER_API_KEY environment variable or replace '<YOUR KEY HERE>' in the script.")


client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=API_KEY,
)


async def get_product_price(product_name: str) -> str:
    """
    Get real-time price information for a product using web scraping.
    Returns a formatted string with price information.
    NOTE: Web scraping is inherently fragile and selectors may break frequently.
    """
    logger.info(f"Attempting to fetch price for: {product_name}")
    try:
        search_query = f"{product_name} price"
        
        encoded_query = search_query.replace(" ", "+")
        
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        }
        
        
        urls = [
            f"https://www.google.com/search?q={encoded_query}&hl=en",
            f"https://www.amazon.com/s?k={encoded_query}",
            f"https://www.ebay.com/sch/i.html?_nkw={encoded_query}",
            f"https://www.etsy.com/search?q={encoded_query}",
            f"https://www.flipkart.com/search?q={encoded_query}",
            f"https://www.temu.com/search_result.html?search_key={encoded_query}",
        ]
        
        craigslist_cities = [
            "newyork", "losangeles", "chicago", "houston", "phoenix",
            "philadelphia", "sanantonio", "sandiego", "dallas", "austin"
        ]
        for city in craigslist_cities:
            urls.append(f"https://{city}.craigslist.org/search/sss?query={encoded_query}")
        
        results = []
        tasks = []

        async def fetch_url(session, url):
            try:
                async with session.get(url, timeout=7) as response: 
                    if response.status == 200:
                        html = await response.text()
                        return html, url
                    else:
                        logger.warning(f"Non-200 status from {url}: {response.status}")
                        return None, url
            except asyncio.TimeoutError:
                logger.warning(f"Timeout fetching from {url}")
                return None, url
            except aiohttp.ClientError as e:
                logger.warning(f"Client error fetching from {url}: {str(e)}")
                return None, url
            except Exception as e:
                logger.warning(f"Generic error fetching from {url}: {str(e)}")
                return None, url

        async with aiohttp.ClientSession(headers=headers) as session:
            for url in urls:
                tasks.append(fetch_url(session, url))
            
            fetched_results = await asyncio.gather(*tasks)

            for html, url in fetched_results:
                if not html:
                    continue
                
                try:
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    
                    if "google.com" in url:
                        price_elements = soup.select('span[jsname="ubtiRe"]')
                        if not price_elements:
                            price_elements = soup.select(".BNeawe.iBp4i.AP7Wnd")
                        
                        for elem in price_elements:
                            text = elem.get_text(strip=True)
                            if any(currency in text for currency in ['$', '€', '£', '¥', '₹']):
                                source_text = "Google Search"
                                parent_container = elem.find_parent('div', recursive=True)
                                if parent_container:
                                    link_tag = parent_container.find('a')
                                    if link_tag and link_tag.get('href'):
                                        domain = re.search(r'https?://(?:www\.)?([^/]+)', link_tag['href'])
                                        if domain:
                                            source_text = domain.group(1).split('.')[0].capitalize()
                                results.append(f"{source_text}: {text}")
                                break

                    
                    elif "amazon.com" in url:
                        price_elements = soup.select(".a-price .a-offscreen")
                        if price_elements:
                            price = price_elements[0].text
                            results.append(f"Amazon: {price}")

                    
                    elif "ebay.com" in url:
                        price_elements = soup.select(".s-item__price")
                        if price_elements:
                            price = price_elements[0].text.strip()
                            results.append(f"eBay: {price}")

                    
                    elif "etsy.com" in url:
                        price_elements = soup.select(".currency-value")
                        if price_elements:
                            currency_symbol = soup.select(".currency-symbol")
                            symbol = currency_symbol[0].text.strip() if currency_symbol else "$"
                            price = f"{symbol}{price_elements[0].text.strip()}"
                            results.append(f"Etsy: {price}")

                    
                    elif "flipkart.com" in url:
                        price_elements = soup.select("._30jeq3")
                        if price_elements:
                            price = price_elements[0].text.strip()
                            results.append(f"Flipkart: {price}")

                    
                    elif "temu.com" in url:
                        price_elements = soup.select("[data-pl='price']")
                        if price_elements:
                            price = price_elements[0].text.strip()
                            results.append(f"Temu: {price}")

                    
                    elif "craigslist.org" in url:
                        price_elements = soup.select(".price")
                        if price_elements:
                            price = price_elements[0].text.strip()
                            city = url.split("//")[1].split(".")[0]
                            results.append(f"Craigslist ({city}): {price}")

                except Exception as e:
                    logger.error(f"Error parsing {url}: {str(e)}")
                    continue

        
        if results:
            unique_results = list(dict.fromkeys(results))
            logger.info(f"Price check results for {product_name}: {unique_results}")
            return f"Found prices for '{product_name}':\n" + "\n".join(unique_results)
        else:
            logger.info(f"No prices found for {product_name}")
            return f"I couldn't find real-time price information for '{product_name}'. Prices can change quickly online!"
            
    except Exception as e:
        logger.error(f"Error in get_product_price for {product_name}: {str(e)}")
        return f"Sorry, I encountered an error while trying to find prices for '{product_name}'."


def is_price_query(message: str) -> tuple[bool, str]:
    """
    Detects if a message is asking about the price of a product.
    Returns (is_price_query, product_name)
    """
    message_lower = message.lower()
    
    patterns = [
        r"(?:what(?:'s| is) the|how much (?:is|are|does|for)|check|find|get|search for|look up).*price (?:of|for) (.+?)(?:\?|$|\.| on | from )",
        r"(?:price|cost) (?:of|for) (.+?)(?:\?|$|\.)",
        r"(?:how much (?:is|are|does)).*?(.+?)(?: cost| sell for| go for)(?:\?|$|\.)",
         r"^(.+?) price(?:\?|$)", 
    ]
    
    for pattern in patterns:
        match = re.search(pattern, message_lower)
        if match:
            product = match.group(1).strip()
            
            product = re.sub(r'^(an?|the|my|your)\s+', '', product).strip()
            
            if product and len(product) > 2 and product not in ["it", "this", "that", "something"]: 
                logger.info(f"Price query detected. Product: '{product}'")
                return True, product
    
    return False, ""



class SessionRequest(BaseModel):
    sessionId: str 

class ChatRequest(SessionRequest): 
    message: str
    priceComparison: Optional[bool] = True 

class ChatResponse(BaseModel):
    response: str 
    session_id: str 

class GreetingResponse(BaseModel):
    greeting: str 
    session_id: str

def build_prompt(session_id: str, user_message: str) -> List[Dict[str, str]]:
    """Builds the prompt for the AI model, including system message and history."""
    
   
    system_prompt = """You are haggle.ai, an expert chatbot specializing ONLY in bargaining and negotiation strategies, advice, and role-playing.

    **Your Core Directives:**
    1.  **Identity:** Always identify yourself as haggle.ai if asked.
    2.  **Focus:** Strictly stick to bargaining, negotiation, pricing, and market dynamics relevant to finance/purchasing. You can discuss product prices if asked, as this is relevant to negotiation.
    3.  **Greeting:** Start every new conversation with a friendly greeting relevant to negotiation.
    4.  **Irrelevance Handling:** * If a user's message seems unrelated to bargaining or negotiation (excluding direct price checks which are allowed), politely ask them to clarify its relevance (e.g., "That's interesting! Could you help me understand how it relates to our negotiation discussion?").
        * If the user provides a reasonable connection, acknowledge it and try to answer within the negotiation context if possible.
        * If the user confirms it's unrelated or provides no clear link, politely state your limitation (e.g., "Thank you for clarifying. As haggle.ai, I'm specifically designed to assist with bargaining and negotiation, including related price checks. I'm not equipped to help with topics outside this domain."). Do NOT answer the unrelated question.
    5.  **Accuracy:** Provide accurate and helpful negotiation advice. When providing prices, state they are estimates found online and can change. Do not invent facts.
    6.  **Context:** Maintain context. Refer back to previous points where relevant. Ask clarifying questions if needed for better advice.
    7.  **Price Context:** When providing price information retrieved by the system (passed in the user message context), present it clearly first, then offer negotiation advice based on that context. For example: "I found these prices online for 'Product X': [Price List]. Keep in mind these can change. Based on this, a good starting point for negotiation might be..."
    """
   
    if session_id not in session_histories:
        session_histories[session_id] = []

   
    messages = [{"role": "system", "content": system_prompt}]
    

    messages.extend(session_histories[session_id])
    
    
    if user_message != "__INITIAL_GREETING__":
        messages.append({"role": "user", "content": user_message})
    
    elif not session_histories[session_id]: 
        messages.append({"role": "user", "content": "Please provide your initial greeting."})

    
    MAX_HISTORY_TURNS = 10 
    if len(messages) > (MAX_HISTORY_TURNS * 2 + 1): 
        
        messages = [messages[0]] + messages[-(MAX_HISTORY_TURNS * 2):]
        
    return messages




@app.get("/", response_class=HTMLResponse)
async def get_chat_page():
    try:
 
        with open("index.html", "r", encoding="utf-8") as f:
            html_content = f.read()
        
        return HTMLResponse(content=html_content)
    except FileNotFoundError:
        logger.error("index.html not found.")
        raise HTTPException(status_code=500, detail="Frontend file not found. Make sure index.html is in the same directory.")
    except Exception as e:
        logger.error(f"Error reading index.html: {e}")
        raise HTTPException(status_code=500, detail="Could not load frontend.")


@app.post("/api/greeting", response_model=GreetingResponse) 
async def send_greeting(request: SessionRequest): 
    session_id = request.sessionId 
    
    
    initial_greeting = "Hello! I'm haggle.ai. Ready to talk negotiation strategies or check some prices? How can I assist you today?"
    
    
    session_histories[session_id] = [{"role": "assistant", "content": initial_greeting}]
    logger.info(f"Session {session_id}: Sent initial greeting via /api/greeting.")
    
    
    return GreetingResponse(greeting=initial_greeting, session_id=session_id)



@app.post("/api/chat", response_model=ChatResponse) 
async def chat_endpoint(request: ChatRequest): 
    """Handles incoming chat messages and returns the bot's reply."""
    session_id = request.sessionId 
    user_message = request.message.strip()
    
    price_comparison_enabled = request.priceComparison

    
    if user_message == "__INITIAL_GREETING__":
         last_message = session_histories.get(session_id, [])[-1]['content'] if session_histories.get(session_id) else "How can I help you?"
         logger.warning(f"Session {session_id}: Received unexpected __INITIAL_GREETING__ at /api/chat")
         
         return ChatResponse(response=last_message, session_id=session_id)

    
    if session_id not in session_histories:
        logger.warning(f"Session {session_id}: History not found at /api/chat, initializing.")
        session_histories[session_id] = []

    
    is_price_request, product_name = is_price_query(user_message)
    
    
    if is_price_request and product_name and price_comparison_enabled:
        logger.info(f"Session {session_id}: Price query detected for '{product_name}' with comparison enabled.")
        
        
        price_info_task = asyncio.create_task(get_product_price(product_name))
        
        
        session_histories[session_id].append({"role": "user", "content": user_message})

        
        price_info = await price_info_task
        
        
        ai_context_message = f"""
        User asked: "{user_message}"
        Price check results: {price_info}
        Please provide negotiation advice based on these findings, keeping the user's original query in mind.
        """
        
        
        messages = build_prompt(session_id, ai_context_message) 
        
        if messages[-1]["role"] == "user" and messages[-1]["content"] == user_message:
             messages.pop() 
        messages.append({"role": "user", "content": ai_context_message}) 

        try:
            
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
            )
            bot_advice = completion.choices[0].message.content.strip()
            
            
            
            combined_reply = f"{price_info}\n\n{bot_advice}"
            
            
            session_histories[session_id].append({"role": "assistant", "content": combined_reply})
            
            logger.info(f"Session {session_id}: Sent price info and negotiation advice.")
            
            return ChatResponse(response=combined_reply, session_id=session_id)
            
        except OpenAIError as e:
            logger.error(f"OpenAI API error during price-enhanced query for session {session_id}: {e}")
            
            session_histories[session_id].append({"role": "assistant", "content": price_info})
            return ChatResponse(response=price_info, session_id=session_id)
        except Exception as e:
            logger.error(f"Unexpected error processing price request for session {session_id}: {e}")
            
            session_histories[session_id].append({"role": "assistant", "content": price_info}) 
            return ChatResponse(response=price_info, session_id=session_id)

    
    else:
        if is_price_request and product_name and not price_comparison_enabled:
             logger.info(f"Session {session_id}: Price query detected for '{product_name}' but comparison is disabled.")
             

        
        messages = build_prompt(session_id, user_message)
        
        
        if not API_KEY or API_KEY == "<YOUR KEY HERE>":
            raise HTTPException(status_code=503, detail="AI Service Unavailable: API Key not configured.")

        try:
            
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                
                
            )

            bot_reply = completion.choices[0].message.content.strip()
            
            
            
            session_histories[session_id].append({"role": "user", "content": user_message})
            session_histories[session_id].append({"role": "assistant", "content": bot_reply})
            
            
            MAX_TOTAL_MESSAGES = 50 
            if len(session_histories[session_id]) > MAX_TOTAL_MESSAGES:
                
                session_histories[session_id] = session_histories[session_id][-MAX_TOTAL_MESSAGES:]

            logger.info(f"Session {session_id}: Received regular reply from model.")
            
            return ChatResponse(response=bot_reply, session_id=session_id)

        except OpenAIError as e:
            
            logger.error(f"OpenAI API error for session {session_id}: {e}")
            raise HTTPException(status_code=503, detail=f"AI service error: {e}")
        except Exception as e:
            
            logger.error(f"Unexpected error for session {session_id}: {e}")
            raise HTTPException(status_code=500, detail="An internal server error occurred.")


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server on http://0.0.0.0:8000")
    
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True) 
