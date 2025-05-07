// Generate a random session ID or retrieve from storage
function generateSessionId() {
    return 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Use sessionStorage for non-persistent ID, localStorage for persistent
let sessionId = sessionStorage.getItem('sessionId');
if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem('sessionId', sessionId);
}

// DOM Elements
const chatBody = document.getElementById('chatBody');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const clearChatButton = document.getElementById('clearChat');
const themeToggle = document.getElementById('themeToggle');
const loadingBar = document.querySelector('.loading-bar');
const suggestionChips = document.querySelectorAll('.suggestion-chip');
const welcomeScreen = document.getElementById('welcomeScreen');
const startButton = document.getElementById('startButton');
const priceToggle = document.getElementById('priceToggle');

// Apply dark mode on load if preference is stored
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
}

// Handle theme toggle click
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    // Store preference in localStorage
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
});

// Auto-resize textarea based on content
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto'; // Reset height
    // Set height based on scroll height, but limit max height
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
});

// Handle Enter key press (send message if Shift is not held)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent default newline insertion
        sendMessage();
    }
});

// Send button click handler
sendButton.addEventListener('click', sendMessage);

// Clear chat button handler
clearChatButton.addEventListener('click', () => {
    // Confirm before clearing
    if (confirm('Are you sure you want to clear this chat history? This will start a new session.')) {
        chatBody.innerHTML = ''; // Clear visual chat
        // Generate a new session ID to effectively reset history on the backend
        sessionId = generateSessionId();
        sessionStorage.setItem('sessionId', sessionId); // Store new ID
        // Fetch a new greeting for the new session
        fetchInitialGreeting();
    }
});

// Close welcome screen handler
startButton.addEventListener('click', () => {
    welcomeScreen.style.opacity = '0';
    // Wait for transition before hiding completely
    setTimeout(() => {
        welcomeScreen.style.display = 'none';
    }, 500);
});

// Add click listeners to suggestion chips
suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
        messageInput.value = chip.textContent; // Set input value
        // Trigger input event to resize textarea if needed
        messageInput.dispatchEvent(new Event('input'));
        sendMessage(); // Send the suggested message
    });
});

/**
 * Improved Markdown to HTML renderer.
 * Handles: **, *, #### headings, \n (newlines), lists (*, -, 1.)
 * Note: This is a simplified renderer. For full Markdown support, a library might be better.
 */
function renderMarkdown(text) {
    // 1. Escape basic HTML tags first to prevent injection
    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 2. Block elements first (headings, lists)
    // Split into lines for easier block processing
    const lines = html.split('\n');
    let inList = null; // 'ul' or 'ol'
    let processedHtml = '';

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Headings (#### -> h4, etc.)
        if (line.startsWith('#')) {
            if (inList) { // Close previous list if inside one
                processedHtml += `</${inList}>\n`;
                inList = null;
            }
            let level = line.match(/^#+/)[0].length;
            level = Math.min(level, 6); // Max h6
            processedHtml += `<h${level}>${line.substring(level).trim()}</h${level}>\n`;
            continue; // Move to next line
        }

        // Unordered lists (* or -)
        if (line.match(/^(\*|-)\s+/)) {
            const itemContent = line.replace(/^(\*|-)\s+/, '').trim();
            if (!inList) { // Start a new list
                inList = 'ul';
                processedHtml += `<ul>\n`;
            } else if (inList === 'ol') { // Switching list type
                 processedHtml += `</ol>\n<ul>\n`;
                 inList = 'ul';
            }
            processedHtml += `  <li>${itemContent}</li>\n`; // Indent for readability
            continue;
        }

        // Ordered lists (1., 2., etc.)
        if (line.match(/^\d+\.\s+/)) {
             const itemContent = line.replace(/^\d+\.\s+/, '').trim();
             if (!inList) { // Start a new list
                inList = 'ol';
                processedHtml += `<ol>\n`;
            } else if (inList === 'ul') { // Switching list type
                 processedHtml += `</ul>\n<ol>\n`;
                 inList = 'ol';
            }
            processedHtml += `  <li>${itemContent}</li>\n`;
            continue;
        }

        // If not a heading or list item, close any open list
        if (inList) {
            processedHtml += `</${inList}>\n`;
            inList = null;
        }

        // Treat remaining lines as paragraphs (handle consecutive blank lines)
        if (line.trim() !== '') {
            // Check if previous line was also content (part of same paragraph)
            if (i > 0 && lines[i-1].trim() !== '' && !lines[i-1].match(/^(\*|-|\d+\.|#)/)) {
                 processedHtml += `<br>${line.trim()}`; // Add line break within paragraph
            } else {
                 processedHtml += `<p>${line.trim()}</p>\n`; // Start new paragraph
            }
        } else {
             // Add an empty paragraph for potentially significant blank lines (optional)
             // Or just ignore blank lines between blocks
        }
    }

     // Close any list that might be open at the end of the text
    if (inList) {
        processedHtml += `</${inList}>\n`;
    }

    html = processedHtml;

    // 3. Inline elements (apply within paragraphs, list items, headings)
    // Bold (**text**) - capture non-greedy
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italics (*text*) - capture non-greedy (ensure it doesn't break list markers if they weren't handled above)
    // This regex is safer as it avoids matching * at the start of a line if list handling failed
    html = html.replace(/(?<!^)\*(.*?)\*/g, '<em>$1</em>');

    // Replace remaining single newlines within generated HTML with <br> (less common now with <p> tags)
    // html = html.replace(/\n/g, '<br>'); // Use cautiously, <p> tags handle most breaks

    return html.trim(); // Trim final whitespace
}


// Function to add a message to the chat interface
// Modified addMessage function
        function addMessage(content, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;

            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // For bot messages, handle differently depending on content
            if (!isUser) {
                // Check if this is a price message by looking for the strong tag with "Found prices for"
                if (content.includes('<strong>Found prices for')) {
                    // Create a temporary div to parse the HTML properly
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = content;

                    // Extract the price results div - this gives us the DOM element itself
                    const priceResultsDiv = tempDiv.querySelector('.price-results');

                    // Get everything before the price results div
                    let beforePrice = '';
                    let currentNode = tempDiv.firstChild;

                    while (currentNode && currentNode !== priceResultsDiv) {
                        if (currentNode.nodeType === 3) { // Text node
                            beforePrice += currentNode.textContent;
                        } else if (currentNode.nodeType === 1) { // Element node
                            beforePrice += currentNode.outerHTML;
                        }
                        currentNode = currentNode.nextSibling;
                    }

                    // Get everything after the price results div
                    let afterPrice = '';
                    if (priceResultsDiv && priceResultsDiv.nextSibling) {
                        currentNode = priceResultsDiv.nextSibling;
                        while (currentNode) {
                            if (currentNode.nodeType === 3) { // Text node
                                afterPrice += currentNode.textContent;
                            } else if (currentNode.nodeType === 1) { // Element node
                                afterPrice += currentNode.outerHTML;
                            }
                            currentNode = currentNode.nextSibling;
                        }
                    }

                    // Create the message content with properly parsed parts
                    const messageContent = document.createElement('div');
                    messageContent.className = 'message-content';

                    // Create message text container
                    const messageTextContainer = document.createElement('div');
                    messageTextContainer.className = 'message-text';

                    // Add before price content with markdown applied
                    if (beforePrice.trim()) {
                        const beforePriceDiv = document.createElement('div');
                        beforePriceDiv.innerHTML = renderMarkdown(beforePrice);
                        messageTextContainer.appendChild(beforePriceDiv);
                    }

                    // Add the price results div as an actual DOM element
                    if (priceResultsDiv) {
                        messageTextContainer.appendChild(priceResultsDiv);
                    }

                    // Add after price content with markdown applied
                    if (afterPrice.trim()) {
                        const afterPriceDiv = document.createElement('div');
                        afterPriceDiv.innerHTML = renderMarkdown(afterPrice);
                        messageTextContainer.appendChild(afterPriceDiv);
                    }

                    // Add time to message content
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'message-time';
                    timeDiv.textContent = timeStr;
                    messageContent.appendChild(messageTextContainer);
                    messageContent.appendChild(timeDiv);

                    // Add avatar and message content to the message div
                    const avatarDiv = document.createElement('div');
                    avatarDiv.className = 'message-avatar';
                    avatarDiv.innerHTML = '<i class="fas fa-robot"></i>';

                    messageDiv.appendChild(avatarDiv);
                    messageDiv.appendChild(messageContent);
                } else {
                    // Regular bot message with no price info - render normally
                    messageDiv.innerHTML = `
                        <div class="message-avatar">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="message-content">
                            <div class="message-text">${renderMarkdown(content)}</div>
                            <div class="message-time">${timeStr}</div>
                        </div>
                    `;
                }
            } else {
                // User message - render normally
                messageDiv.innerHTML = `
                    <div class="message-content">
                        <div class="message-text">${content}</div>
                        <div class="message-time">${timeStr}</div>
                    </div>
                    <div class="message-avatar user-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                `;
            }

            chatBody.appendChild(messageDiv);
            chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
        }

// Function to show the typing indicator
function showTypingIndicator() {
    // Prevent adding multiple indicators
    if (document.getElementById('typingIndicator')) return;

    const indicator = document.createElement('div');
    indicator.className = 'message bot-message'; // Style like a bot message
    indicator.id = 'typingIndicator'; // ID for easy removal

    indicator.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;

    chatBody.appendChild(indicator);
    chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
}

// Function to remove the typing indicator
function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.remove();
    }
}

// Function to format price information within the bot's response
// Looks for the specific "Found prices for..." structure generated by the backend
function formatPriceInfo(text) {
    if (text.includes('<div class="price-results">')) {
// Already formatted, return as is
        return text;
    }
    const priceHeader = "Found prices for";
    // Check if the price header exists in the text

    if (!text.includes(priceHeader)) return text;

    // Find the start of the price section
    const priceInfoStart = text.indexOf(priceHeader);
    // Find the end of the price section (double newline often separates it)
    let priceInfoEnd = text.indexOf('\n\n', priceInfoStart);
    // If no double newline, assume it's the rest of the message
    if (priceInfoEnd === -1) {
        priceInfoEnd = text.length;
    }

    // Extract the price section and the rest of the text
    const priceInfoSection = text.substring(priceInfoStart, priceInfoEnd);
    const restOfText = text.substring(priceInfoEnd); // Includes the \n\n if found

    // Split the price section into lines
    const lines = priceInfoSection.split('\n');
    // The first line is the product name header
    const productLine = lines[0];
    // The rest are the price lines (Source: Price)
    const priceLines = lines.slice(1);

    // Start building the formatted HTML for the price results
    // Escape productLine to prevent potential XSS if product name contains HTML
    const escapedProductLine = productLine.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let formattedPriceInfo = `<div class="price-results"><strong>${escapedProductLine}</strong>`;

    // Process each price line
    priceLines.forEach(line => {
        const parts = line.split(': '); // Split "Source: Price"
        if (parts.length === 2) { // Ensure correct format
            const source = parts[0].trim().replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Escape source
            const price = parts[1].trim().replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Escape price
            // Add formatted line to the HTML
            formattedPriceInfo += `<div><span class="price-source">${source}</span>: ${price}</div>`;
        } else if (line.trim()) {
             // Add lines that don't match the pattern as plain text (escaped)
             formattedPriceInfo += `<div>${line.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
        }
    });

    formattedPriceInfo += `</div>`; // Close the price-results div

    // Return the text before the price section, the formatted price section, and the rest of the text
    // Note: The restOfText still needs markdown processing later by addMessage
    return text.substring(0, priceInfoStart) + formattedPriceInfo + restOfText;
}

// Function to send message to the backend API
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return; // Do nothing if input is empty

    // Add user's message to the chat display (as plain text)
    addMessage(message, true);

    // Clear the input field and reset its height
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Show typing indicator while waiting for response
    showTypingIndicator();

    // Show the loading bar animation
    loadingBar.style.display = 'block';
    sendButton.disabled = true; // Disable send button

    // Prepare the data payload for the API request
    const requestData = {
        message: message,
        sessionId: sessionId,
        priceComparison: priceToggle.checked // Include price comparison preference
    };

    try {
        // Send POST request to the chat endpoint
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        // Hide loading bar regardless of success/failure
        loadingBar.style.display = 'none';
        removeTypingIndicator(); // Remove typing indicator
        sendButton.disabled = false; // Re-enable send button

        if (!response.ok) {
            // Handle HTTP errors (e.g., 404, 500)
            const errorData = await response.json().catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
            console.error('API Error Response:', errorData);
            addMessage(`Sorry, I encountered an error (${response.status}). Please try again later.`);
            return; // Stop processing on error
        }

        // Parse the JSON response from the API
        const data = await response.json();

        // --- Process Bot Response ---
        let botResponseText = data.response;

        // 1. Format price info first if applicable (returns HTML for price part)
        let formattedContent = botResponseText; // Start with raw response
        if (priceToggle.checked && botResponseText.includes('Found prices for')) {
             // This function now returns HTML for the price block + raw markdown for the rest
            formattedContent = formatPriceInfo(botResponseText);
        }

        // 2. Add the message (which internally calls renderMarkdown for the bot message)
        // renderMarkdown will handle the rest of the markdown in the response
        addMessage(formattedContent, false); // Pass potentially mixed HTML/Markdown content

    } catch (error) {
        // Handle network errors or other exceptions
        console.error('Fetch Error:', error);
        loadingBar.style.display = 'none'; // Ensure loading bar is hidden on error
        removeTypingIndicator(); // Ensure typing indicator is removed
        sendButton.disabled = false; // Re-enable send button
        addMessage('Sorry, I couldn\'t connect to the assistant. Please check your connection and try again.');
    }
}

// Function to fetch the initial greeting message from the backend
async function fetchInitialGreeting() {
    // Show typing indicator while fetching
    showTypingIndicator();

    try {
        // Send POST request to the greeting endpoint
        const response = await fetch('/api/greeting', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId: sessionId }) // Send session ID
        });

        removeTypingIndicator(); // Remove indicator once fetch is done

        if (!response.ok) {
            // Handle HTTP errors
            throw new Error(`Network response was not ok (${response.status})`);
        }

        // Parse the JSON response
        const data = await response.json();
        // Add the greeting message to the chat (will be markdown rendered)
        addMessage(data.greeting, false); // Add as bot message

    } catch (error) {
         // Handle network errors or other exceptions
        console.error('Error fetching initial greeting:', error);
        removeTypingIndicator(); // Ensure indicator is removed on error
        // Provide a fallback greeting if the API call fails
        addMessage('Hello! I\'m your negotiation assistant, haggle.ai. How can I help you today?', false); // Add as bot message
    }
}

// Initialize the chat: Fetch the initial greeting when the page loads
fetchInitialGreeting();

// Show welcome screen only if it hasn't been dismissed in this session
if (!sessionStorage.getItem('welcomeDismissed')) {
     welcomeScreen.style.display = 'flex'; // Show the welcome screen
     // Mark as dismissed for this session when button clicked
     startButton.addEventListener('click', () => {
         sessionStorage.setItem('welcomeDismissed', 'true');
     }, { once: true }); // Only run this listener once
} else {
     welcomeScreen.style.display = 'none'; // Hide if already dismissed
}