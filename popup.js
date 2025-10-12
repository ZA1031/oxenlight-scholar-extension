// Configuration
const CONFIG = {
    DEFAULT_API_URL: 'https://www.oxenlight.com'
};

// DOM Elements
const loginFormEl = document.getElementById('login-form');
const loadingEl = document.getElementById('loading');
const paperInfoEl = document.getElementById('paper-info');
const manualFormEl = document.getElementById('manual-form');
const successEl = document.getElementById('success-message');
const errorEl = document.getElementById('error-message');

// State
let currentPaperData = null;
let userSession = null;
let extractedPaperTitle = null;

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    await initializeExtension();
    setupEventListeners();
});

async function initializeExtension() {
    try {
        console.log('Initializing extension...');
        
        // Check if user is already authenticated
        userSession = await getUserSession();
        console.log('User session:', userSession);
        
        if (userSession && userSession.isAuthenticated) {
            // User is logged in, proceed to extract paper info
            await extractPaperInfo();
        } else {
            // Show login form
            showLoginForm();
            
            // Check if this is first install and show welcome page
            const isFirstRun = await checkFirstRun();
            if (isFirstRun) {
                showWelcomePage();
            }
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showLoginForm();
    }
}

async function checkFirstRun() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['firstRunCompleted'], (result) => {
            if (result.firstRunCompleted) {
                resolve(false);
            } else {
                // Mark as completed for future runs
                chrome.storage.local.set({ firstRunCompleted: true });
                resolve(true);
            }
        });
    });
}

function showWelcomePage() {
    chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html')
    });
}

function showLoginForm() {
    hideAllSections();
    loginFormEl.classList.remove('hidden');
    
    // Auto-fill platform URL
    document.getElementById('platform-url').value = CONFIG.DEFAULT_API_URL;
}

async function extractPaperInfo() {
    try {
        showLoading('Analyzing page for paper information...');
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            throw new Error('No active tab found');
        }
        
        // Inject content script to extract paper data
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractPaperDataFromPage
        });
        
        const paperData = results[0]?.result;
        
        if (paperData && paperData.title) {
            extractedPaperTitle = paperData.title;
            await fetchPaperMetadata(paperData.title);
        } else {
            showManualForm();
        }
    } catch (error) {
        console.error('Error extracting paper info:', error);
        showManualForm();
    }
}

async function fetchPaperMetadata(paperTitle) {
    try {
        showLoading('Fetching paper metadata from database...');
        
        const apiUrl = `${userSession.platformUrl}/backend/oxenlight_scholar/auto_fill_paper_details`;
        console.log('Fetching metadata from:', apiUrl);
        
        const formData = new URLSearchParams();
        formData.append('paper_title', paperTitle);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData,
            credentials: 'include'
        });
        
        console.log('Metadata API response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Metadata API result:', result);
        
        if (result.status === 'success' && result.data && result.data.length > 0) {
            // Use the best matching paper (first result after sorting by similarity)
            const bestMatch = result.data[0];
            displayPaperInfo(bestMatch);
        } else {
            // Fall back to basic extracted data
            const fallbackData = {
                title: paperTitle,
                authors: 'Not available',
                venue: 'Not available',
                year: 'Not available',
                summary: 'No metadata found in database'
            };
            displayPaperInfo(fallbackData);
        }
    } catch (error) {
        console.error('Error fetching paper metadata:', error);
        // Fall back to basic extracted data
        const fallbackData = {
            title: paperTitle,
            authors: 'Not available',
            venue: 'Not available',
            year: 'Not available',
            summary: 'Error fetching metadata'
        };
        displayPaperInfo(fallbackData);
    }
}

function displayPaperInfo(paperData) {
    document.getElementById('paper-title').textContent = paperData.title || 'Unknown Title';
    document.getElementById('paper-authors').textContent = paperData.authors || 'Authors not available';
    document.getElementById('paper-venue').textContent = paperData.venue || 'Venue not available';
    document.getElementById('paper-year').textContent = paperData.year_published || paperData.year || 'Year not available';
    
    // Store paper data for later use
    currentPaperData = paperData;
    
    hideAllSections();
    paperInfoEl.classList.remove('hidden');
}

function showManualForm() {
    hideAllSections();
    manualFormEl.classList.remove('hidden');
    
    // If we have an extracted title, pre-fill it
    if (extractedPaperTitle) {
        document.getElementById('manual-title').value = extractedPaperTitle;
    }
}

function showLoading(message = 'Loading...') {
    hideAllSections();
    loadingEl.querySelector('p').textContent = message;
    loadingEl.classList.remove('hidden');
}

function setupEventListeners() {
    // Login form
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('forgot-password').addEventListener('click', handleForgotPassword);
    document.getElementById('open-welcome').addEventListener('click', showWelcomePage);
    
    // Paper actions
    document.getElementById('request-btn').addEventListener('click', requestPaper);
    document.getElementById('manual-btn').addEventListener('click', () => {
        paperInfoEl.classList.add('hidden');
        manualFormEl.classList.remove('hidden');
    });
    
    // Manual form
    document.getElementById('submit-manual').addEventListener('click', submitManualRequest);
    document.getElementById('cancel-manual').addEventListener('click', () => {
        manualFormEl.classList.add('hidden');
        if (currentPaperData) {
            paperInfoEl.classList.remove('hidden');
        } else {
            showManualForm();
        }
    });
    
    // Footer actions
    document.getElementById('open-dashboard').addEventListener('click', openDashboard);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Enter key support for login
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });
}

async function handleLogin() {
    const platformUrl = document.getElementById('platform-url').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    // Basic validation
    if (!platformUrl || !email || !password) {
        showError('Please fill in all fields');
        return;
    }
    
    if (!isValidUrl(platformUrl)) {
        showError('Please enter a valid platform URL');
        return;
    }
    
    try {
        showLoading('Logging in...');
        
        const loginSuccess = await performLogin(platformUrl, email, password);
        
        if (loginSuccess) {
            // Store platform URL for future use
            await saveToStorage('platformUrl', platformUrl);
            
            // Proceed to extract paper info
            await extractPaperInfo();
        } else {
            showError('Login failed. Please check your credentials.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Login failed. Please try again.');
    }
}

async function performLogin(platformUrl, email, password) {
    // Your login API endpoint
    const loginUrl = `${platformUrl}/login/validate_login`;
    
    try {
        console.log('Attempting login to:', loginUrl);
        
        // Create form data exactly like your web form
        const formData = new URLSearchParams();
        formData.append('email', email);
        formData.append('password', password);
        
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData,
            credentials: 'include' // Important for session cookies
        });
        
        console.log('Login response status:', response.status);
        
        // For your current setup, we'll check if we can access a protected page
        const canAccessScholar = await checkScholarAccess(platformUrl);
        
        if (canAccessScholar) {
            // Store user session
            userSession = {
                isAuthenticated: true,
                userData: {
                    email: email,
                    user_role: 'student' // Assuming student for now
                },
                platformUrl: platformUrl,
                timestamp: Date.now()
            };
            
            await saveUserSession(userSession);
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('Login API error:', error);
        return false;
    }
}

async function checkScholarAccess(platformUrl) {
    try {
        const scholarUrl = `${platformUrl}/backend/oxenlight_scholar`;
        console.log('Checking scholar access:', scholarUrl);
        
        const response = await fetch(scholarUrl, {
            credentials: 'include',
            redirect: 'manual'
        });
        
        console.log('Scholar access check status:', response.status);
        
        // If we get a 200, we're logged in. If we get a redirect (302), we're not logged in
        return response.status === 200;
    } catch (error) {
        console.error('Scholar access check error:', error);
        return false;
    }
}

async function requestPaper() {
    if (!currentPaperData) {
        showError('No paper data available');
        return;
    }
    
    await submitPaperRequest(currentPaperData);
}

async function submitManualRequest() {
    const title = document.getElementById('manual-title').value.trim();
    
    if (!title) {
        showError('Paper title is required');
        return;
    }
    
    const paperData = {
        title: title,
        authors: document.getElementById('manual-authors').value.trim(),
        year: document.getElementById('manual-year').value.trim(),
        venue: document.getElementById('manual-venue').value.trim(),
        link: await getCurrentTabUrl() || '',
        type: 'Article',
        summary: '',
        citations: 0,
        peer_reviewed: 0
    };
    
    await submitPaperRequest(paperData);
}

async function submitPaperRequest(paperData) {
    try {
        showLoading('Submitting paper request...');
        
        const requestData = {
            name: paperData.title,
            paper_link: paperData.link || '',
            authors: paperData.authors || '',
            year_published: paperData.year || '',
            type: paperData.type || 'Article',
            summary: paperData.summary || '',
            venue: paperData.venue || '',
            citations: paperData.citations || 0,
            peer_reviewed: paperData.peer_reviewed || 0
        };
        
        const apiUrl = `${userSession.platformUrl}/backend/oxenlight_scholar/create`;
        console.log('Submitting paper to:', apiUrl);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(requestData),
            credentials: 'include'
        });
        
        console.log('Paper submission response status:', response.status);
        
        // Handle response - your create function returns JSON
        const result = await response.json();
        
        if (result.status === 'success') {
            showSuccess();
        } else {
            showError(result.message || 'Failed to request paper');
        }
    } catch (error) {
        console.error('Paper request error:', error);
        showError('Network error. Please try again.');
    }
}

async function handleLogout() {
    try {
        if (userSession && userSession.platformUrl) {
            // Call your logout endpoint
            await fetch(`${userSession.platformUrl}/login/logout`, {
                method: 'GET',
                credentials: 'include'
            });
        }
        
        // Clear local storage
        await clearStorage();
        userSession = null;
        currentPaperData = null;
        extractedPaperTitle = null;
        
        showLoginForm();
    } catch (error) {
        console.error('Logout error:', error);
        // Still show login form even if logout request fails
        showLoginForm();
    }
}

function handleForgotPassword(e) {
    e.preventDefault();
    chrome.tabs.create({
        url: `${CONFIG.DEFAULT_API_URL}/login/forgot_password`
    });
}

function openDashboard(e) {
    e.preventDefault();
    if (userSession && userSession.platformUrl) {
        chrome.tabs.create({
            url: `${userSession.platformUrl}/backend/oxenlight_scholar`
        });
    } else {
        showError('Please login first');
    }
}

// Content script function to extract paper data
function extractPaperDataFromPage() {
    const paperData = {};
    const hostname = window.location.hostname;
    
    console.log('Extracting paper data from:', hostname);
    
    // ScienceDirect
    if (hostname.includes('sciencedirect')) {
        paperData.title = document.querySelector('.title-text')?.textContent?.trim() ||
                         document.querySelector('h1')?.textContent?.trim();
        
        paperData.authors = Array.from(document.querySelectorAll('.author span'))
            .map(el => el.textContent?.trim())
            .filter(Boolean)
            .join(', ');
            
        paperData.venue = document.querySelector('.publication-title')?.textContent?.trim();
        paperData.year = document.querySelector('.publication-volume')?.textContent?.match(/\d{4}/)?.[0];
    }
    // IEEE Xplore
    else if (hostname.includes('ieeexplore')) {
        paperData.title = document.querySelector('.document-title')?.textContent?.trim();
        paperData.authors = Array.from(document.querySelectorAll('.authors .stats-document-authors'))
            .map(el => el.textContent?.trim())
            .join(', ');
        paperData.venue = document.querySelector('.pub-title')?.textContent?.trim();
        paperData.year = document.querySelector('.doc-abstract-pubdate')?.textContent?.match(/\d{4}/)?.[0];
    }
    // Springer
    else if (hostname.includes('springer')) {
        paperData.title = document.querySelector('.c-article-title')?.textContent?.trim();
        paperData.authors = Array.from(document.querySelectorAll('.c-article-author-list li'))
            .map(el => el.textContent?.trim())
            .join(', ');
        paperData.venue = document.querySelector('.c-article-info-details')?.textContent?.trim();
        paperData.year = document.querySelector('.c-bibliographic-information__value')?.textContent?.match(/\d{4}/)?.[0];
    }
    // ACM Digital Library
    else if (hostname.includes('acm.org')) {
        paperData.title = document.querySelector('.citation__title')?.textContent?.trim() ||
                         document.querySelector('h1')?.textContent?.trim();
        paperData.authors = Array.from(document.querySelectorAll('.loa__item-name'))
            .map(el => el.textContent?.trim())
            .join(', ');
        paperData.venue = document.querySelector('.epub-section__title')?.textContent?.trim();
        paperData.year = document.querySelector('.citation__year')?.textContent?.trim();
    }
    // arXiv
    else if (hostname.includes('arxiv.org')) {
        paperData.title = document.querySelector('.title math')?.textContent?.trim() ||
                         document.querySelector('.title')?.textContent?.replace('Title:', '').trim();
        paperData.authors = Array.from(document.querySelectorAll('.authors a'))
            .map(el => el.textContent?.trim())
            .join(', ');
        paperData.venue = 'arXiv';
        paperData.year = document.querySelector('.dateline')?.textContent?.match(/\d{4}/)?.[0];
    }
    // Generic fallback - try meta tags first
    else {
        // Try citation meta tags (common across academic sites)
        const citationTitle = document.querySelector('meta[name="citation_title"]')?.content;
        const citationAuthors = document.querySelectorAll('meta[name="citation_author"]');
        const citationJournal = document.querySelector('meta[name="citation_journal_title"]')?.content;
        const citationDate = document.querySelector('meta[name="citation_publication_date"]')?.content;
        const citationYear = document.querySelector('meta[name="citation_year"]')?.content;
        
        paperData.title = citationTitle ||
                         document.querySelector('meta[property="og:title"]')?.content ||
                         document.title;
        
        if (citationAuthors.length > 0) {
            paperData.authors = Array.from(citationAuthors)
                .map(meta => meta.content)
                .join(', ');
        } else {
            paperData.authors = document.querySelector('meta[name="author"]')?.content || 'Not available';
        }
        
        paperData.venue = citationJournal || 'Not available';
        paperData.year = citationYear || citationDate?.match(/\d{4}/)?.[0] || 'Not available';
    }
    
    paperData.link = window.location.href;
    
    console.log('Extracted paper data:', paperData);
    return paperData;
}

// Utility functions
async function getCurrentTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || '';
}

async function getUserSession() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userSession'], (result) => {
            resolve(result.userSession || null);
        });
    });
}

async function saveUserSession(session) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ userSession: session }, () => {
            resolve();
        });
    });
}

async function saveToStorage(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => {
            resolve();
        });
    });
}

async function clearStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.clear(() => {
            resolve();
        });
    });
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function showSuccess() {
    hideAllSections();
    successEl.classList.remove('hidden');
    
    // Auto-close after 2 seconds
    setTimeout(() => {
        window.close();
    }, 2000);
}

function showError(message) {
    hideAllSections();
    document.getElementById('error-text').textContent = message;
    errorEl.classList.remove('hidden');
}

function hideAllSections() {
    [loginFormEl, loadingEl, paperInfoEl, manualFormEl, successEl, errorEl].forEach(el => {
        el.classList.add('hidden');
    });
}