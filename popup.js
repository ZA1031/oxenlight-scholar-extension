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

        // Update footer based on authentication state
        updateFooterState();

        if (userSession && userSession.isAuthenticated) {
            // User is logged in, proceed to extract paper info
            await extractPaperInfo();
        } else {
            // Show login form
            showLoginForm();

            // Load remembered credentials if available
            await loadRememberedCredentials();

            // Check if this is first install and show welcome page
            const isFirstRun = await checkFirstRun();
            if (isFirstRun) {
                // showWelcomePage();
            }
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showLoginForm();
    }
}
async function loadRememberedCredentials() {
    const credentials = await getRememberedCredentials();

    if (credentials) {
        // Auto-fill the form
        document.getElementById('email').value = credentials.email;
        document.getElementById('password').value = credentials.password;
        document.getElementById('remember-me').checked = true;

        console.log('Loaded remembered credentials for:', credentials.email);
    }
}
function updateFooterState() {
    const authenticatedLinks = document.getElementById('authenticated-links');
    const unauthenticatedLinks = document.getElementById('unauthenticated-links');

    if (userSession && userSession.isAuthenticated) {
        authenticatedLinks.classList.remove('hidden');
        unauthenticatedLinks.classList.add('hidden');
    } else {
        authenticatedLinks.classList.add('hidden');
        unauthenticatedLinks.classList.remove('hidden');
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
/**
 * Save credentials to storage (encrypted in production)
 */
async function saveRememberedCredentials(email, password) {
    return new Promise((resolve) => {
        chrome.storage.local.set({
            rememberedCredentials: {
                email: email,
                // In production, you should encrypt the password
                // For now, storing as-is (NOT RECOMMENDED for production)
                password: password,
                timestamp: Date.now()
            }
        }, () => {
            resolve();
        });
    });
}

/**
 * Get remembered credentials from storage
 */
async function getRememberedCredentials() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['rememberedCredentials'], (result) => {
            resolve(result.rememberedCredentials || null);
        });
    });
}

/**
 * Clear remembered credentials
 */
async function clearRememberedCredentials() {
    return new Promise((resolve) => {
        chrome.storage.local.remove(['rememberedCredentials'], () => {
            resolve();
        });
    });
}
async function extractPaperInfo() {
    try {
        showLoading('Analyzing page for paper information...');

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            console.log('No active tab found');
            showManualForm();
            return;
        }

        // Check if we can inject content script (avoid errors on restricted pages)
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            console.log('Cannot extract from Chrome internal pages');
            showManualForm();
            return;
        }

        // Inject content script to extract paper data
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractPaperDataFromPage
        }).catch(error => {
            console.log('Content script injection failed:', error.message);
            return null;
        });

        if (!results || !results[0]?.result) {
            console.log('No paper data extracted from page');
            showManualForm();
            return;
        }

        const paperData = results[0].result;

        if (paperData && paperData.title) {
            extractedPaperTitle = paperData.title;
            await fetchPaperMetadata(paperData.title);
        } else {
            console.log('No paper title found on page');
            showManualForm();
        }
    } catch (error) {
        console.log('Paper extraction failed:', error.message);
        showManualForm();
    }
}

async function fetchPaperMetadata(paperTitle) {
    try {
        showLoading('Fetching paper metadata from database...');

        if (!userSession || !userSession.platformUrl) {
            console.log('No user session available');
            throw new Error('Authentication required');
        }

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
        }).catch(error => {
            console.log('Network error fetching metadata:', error.message);
            throw new Error('Network error');
        });

        console.log('Metadata API response status:', response.status);

        if (!response.ok) {
            console.log('API response not OK:', response.status);
            throw new Error(`API request failed with status ${response.status}`);
        }

        const result = await response.json().catch(error => {
            console.log('JSON parsing error:', error.message);
            throw new Error('Invalid response from server');
        });

        console.log('Metadata API result:', result);

        if (result.status === 'success' && result.data && result.data.length > 0) {
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
        console.log('Metadata fetch failed:', error.message);
        // Fall back to basic extracted data without throwing error
        const fallbackData = {
            title: paperTitle,
            authors: 'Not available',
            venue: 'Not available',
            year: 'Not available',
            summary: 'Error fetching metadata: ' + error.message
        };
        displayPaperInfo(fallbackData);
    }
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
            // If no paper data, go back to extraction or login
            if (userSession && userSession.isAuthenticated) {
                extractPaperInfo();
            } else {
                showLoginForm();
            }
        }
    });

    // Read More button - use event delegation
    document.addEventListener('click', function (e) {
        if (e.target.id === 'read-more-btn') {
            toggleReadMore();
        }
    });
    // Footer actions - Use event delegation for dynamically shown elements
    document.addEventListener('click', function (e) {
        // Open Dashboard
        if (e.target.id === 'open-dashboard') {
            e.preventDefault();
            openDashboard();
        }
        // Logout
        if (e.target.id === 'logout-btn') {
            e.preventDefault();
            handleLogout();
        }
        // Learn More
        if (e.target.id === 'learn-more') {
            e.preventDefault();
            showWelcomePage();
        }
    });

    // Error actions
    document.getElementById('back-to-login').addEventListener('click', () => {
        errorEl.classList.add('hidden');
        showLoginForm();
    });

    document.getElementById('back-to-paper').addEventListener('click', () => {
        errorEl.classList.add('hidden'); // Clear error state first
        if (currentPaperData) {
            paperInfoEl.classList.remove('hidden');
        } else {
            showManualForm();
        }
    });

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
    const rememberMe = document.getElementById('remember-me').checked;

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

            // Handle Remember Me
            if (rememberMe) {
                await saveRememberedCredentials(email, password);
                console.log('Credentials saved for next login');
            } else {
                // Clear any previously saved credentials
                await clearRememberedCredentials();
                console.log('Credentials cleared');
            }

            // Update footer state
            updateFooterState();

            // Proceed to extract paper info
            await extractPaperInfo();
        } else {
            showError('Login failed. Please check your credentials.', true);
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
        showLoading('Checking for duplicates...');

        const peerReviewedValue = paperData.peer_reviewed === true ? 1 : 0;

        const requestData = {
            name: paperData.title,
            paper_link: paperData.link || '',
            authors: paperData.authors || '',
            year_published: paperData.year_published || paperData.year || '',
            type: paperData.type || 'Article',
            summary: paperData.summary || '',
            venue: paperData.venue || '',
            citations: paperData.citations || 0,
            peer_reviewed: peerReviewedValue,
            is_extension: true
        };

        console.log('Submitting paper data:', requestData);

        // Step 1: Check if paper already exists in library
        const checkApiUrl = `${userSession.platformUrl}/backend/oxenlight_scholar/check_paper_in_library`;
        console.log('Checking duplicates at:', checkApiUrl);

        const checkResponse = await fetch(checkApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                paper_title: paperData.title
            }),
            credentials: 'include'
        });

        console.log('Duplicate check response status:', checkResponse.status);

        if (!checkResponse.ok) {
            throw new Error(`Duplicate check failed with status ${checkResponse.status}`);
        }

        const checkResult = await checkResponse.json();
        console.log('Duplicate check result:', checkResult);

        if (checkResult.exists) {
            showError('This paper already exists in the library!');
            return;
        }

        // Step 2: If no duplicate, proceed with submission
        showLoading('Submitting paper request...');

        const createApiUrl = `${userSession.platformUrl}/backend/oxenlight_scholar/create`;
        console.log('Submitting paper to:', createApiUrl);

        const response = await fetch(createApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(requestData),
            credentials: 'include'
        });

        console.log('Paper submission response status:', response.status);

        const result = await response.json();

        if (result.status === 'success') {
            showSuccess('Paper requested successfully! It will be reviewed by your mentor.');
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

        // Clear only user session data, NOT remembered credentials
        // This allows "Remember Me" to persist across logouts
        await chrome.storage.local.remove(['userSession', 'platformUrl', 'firstRunCompleted']);

        userSession = null;
        currentPaperData = null;
        extractedPaperTitle = null;

        // Update footer state
        updateFooterState();

        showLoginForm();

        // Load remembered credentials if available
        await loadRememberedCredentials();
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

function openDashboard(e = null) {
    if (e) {
        e.preventDefault();
    }

    if (userSession && userSession.isAuthenticated && userSession.platformUrl) {
        chrome.tabs.create({
            url: `${userSession.platformUrl}/backend/oxenlight_scholar`
        });
    } else {
        showError('Please login first');
    }
}
function toggleReadMore() {
    const summaryElement = document.getElementById('paper-summary');
    const readMoreBtn = document.getElementById('read-more-btn');

    if (summaryElement.classList.contains('expanded')) {
        // Collapse
        summaryElement.classList.remove('expanded');
        readMoreBtn.textContent = 'Read more';
    } else {
        // Expand
        summaryElement.classList.add('expanded');
        readMoreBtn.textContent = 'Read less';
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
function showError(message, showButtons = true) {
    hideAllSections();

    // Special styling for duplicate papers
    const errorText = document.getElementById('error-text');
    errorText.textContent = message;

    if (message.includes('already exists')) {
        errorText.style.color = '#d63031'; // Red color for duplicates
        errorText.style.fontWeight = 'bold';
    } else {
        errorText.style.color = ''; // Reset to default
        errorText.style.fontWeight = '';
    }

    const errorActions = document.querySelector('.error-actions');
    const backToLoginBtn = document.getElementById('back-to-login');
    const backToPaperBtn = document.getElementById('back-to-paper');

    // Show/hide action buttons based on context
    if (message.includes('Please login first') || !userSession || !userSession.isAuthenticated) {
        backToLoginBtn.style.display = 'block';
        backToPaperBtn.style.display = 'none';
        backToLoginBtn.textContent = 'Login';
    } else if (showButtons) {
        backToLoginBtn.style.display = 'none';
        backToPaperBtn.style.display = 'block';
        backToPaperBtn.textContent = 'Back';
    } else {
        backToLoginBtn.style.display = 'block';
        backToPaperBtn.style.display = 'block';
        backToLoginBtn.textContent = 'Login';
        backToPaperBtn.textContent = 'Back';
    }
    errorEl.classList.remove('hidden');
}
function hideAllSections() {
    [loginFormEl, loadingEl, paperInfoEl, manualFormEl, successEl, errorEl].forEach(el => {
        el.classList.add('hidden');
    });
}

function displayPaperInfo(paperData) {
    // Set all the metadata fields
    document.getElementById('paper-title').textContent = paperData.title || 'Unknown Title';
    document.getElementById('paper-authors').textContent = paperData.authors || 'Not available';
    document.getElementById('paper-venue').textContent = paperData.venue || 'Not available';
    document.getElementById('paper-year').textContent = paperData.year_published || paperData.year || 'Not available';
    document.getElementById('paper-citations').textContent = paperData.citations ? `${paperData.citations} citations` : 'No citations';
    document.getElementById('paper-type').textContent = paperData.type || 'Article';

    // Set paper link
    const paperLink = document.getElementById('paper-link');
    if (paperData.link && paperData.link !== '#') {
        paperLink.href = paperData.link;
        paperLink.textContent = 'View original paper';
        paperLink.style.color = '';
        paperLink.style.pointerEvents = '';
    } else {
        paperLink.href = '#';
        paperLink.textContent = 'No source available';
        paperLink.style.color = '#999';
        paperLink.style.pointerEvents = 'none';
    }

    // Show peer reviewed badge if applicable
    const peerReviewedBadge = document.getElementById('peer-reviewed-badge');
    if (paperData.peer_reviewed) {
        peerReviewedBadge.classList.remove('hidden');
    } else {
        peerReviewedBadge.classList.add('hidden');
    }

    // Handle read more functionality for long summaries
    const summaryElement = document.getElementById('paper-summary');
    const readMoreBtn = document.getElementById('read-more-btn');

    // Reset summary element
    summaryElement.classList.remove('expanded');
    summaryElement.textContent = paperData.summary || 'No summary available';

    if (paperData.summary && paperData.summary.length > 200) {
        readMoreBtn.classList.remove('hidden');
        readMoreBtn.textContent = 'Read more';
    } else {
        readMoreBtn.classList.add('hidden');
    }

    // Store paper data for later use
    currentPaperData = {
        title: paperData.title,
        link: paperData.link || '',
        authors: paperData.authors || '',
        year_published: paperData.year_published || paperData.year || '',
        type: paperData.type || 'Article',
        summary: paperData.summary || '',
        venue: paperData.venue || '',
        citations: paperData.citations || 0,
        peer_reviewed: paperData.peer_reviewed || 0
    };

    hideAllSections();
    paperInfoEl.classList.remove('hidden');
}