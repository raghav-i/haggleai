# haggle.ai

A negotiation assistant chatbot with real-time price comparison capabilities.

## Features

- Negotiation advice and strategies
- Real-time price comparison across multiple retailers
- Negotiation role-play practice
- Dark/Light theme toggle

## Setup

1. Clone this repository
   ```
   git clone https://github.com/raghav-i/haggleai.git
   ```
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Create a `.env` file with:
   ```
   OPENROUTER_API_KEY=your_key_here
   ```
4. Run the app:
   ```
   python main.py
   ```
5. Access at `http://localhost:8000`

## How It Works

- FastAPI backend with DeepSeek AI model via OpenRouter
- Web scraping for price comparison across multiple retailers
- Responsive chat UI with modern design