// Content script that runs on academic websites
// This script can communicate with the popup and extract page data

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPaperData') {
        const paperData = extractPaperMetadata();
        sendResponse({ paperData });
    }
    return true;
});

// Extract paper metadata from the current page
function extractPaperMetadata() {
    const metadata = {
        title: '',
        authors: '',
        year: '',
        link: window.location.href,
        abstract: '',
        doi: '',
        venue: '',
        citations: 0,
        type: 'Article',
        peerReviewed: false
    };

    // Extract based on current domain
    const hostname = window.location.hostname;

    if (hostname.includes('sciencedirect.com')) {
        return extractScienceDirect(metadata);
    } else if (hostname.includes('ieeexplore.ieee.org')) {
        return extractIEEE(metadata);
    } else if (hostname.includes('springer.com')) {
        return extractSpringer(metadata);
    } else if (hostname.includes('nature.com')) {
        return extractNature(metadata);
    } else if (hostname.includes('arxiv.org')) {
        return extractArxiv(metadata);
    } else {
        return extractGeneric(metadata);
    }
}

// ScienceDirect extractor
function extractScienceDirect(metadata) {
    metadata.title =
        document.querySelector('meta[name="citation_title"]')?.content ||
        document.querySelector('h1.title-text')?.textContent?.trim() ||
        document.querySelector('span.title-text')?.textContent?.trim();

    const authorElements = document.querySelectorAll('meta[name="citation_author"]');
    metadata.authors = Array.from(authorElements).map(el => el.content).join(', ');

    metadata.year = document.querySelector('meta[name="citation_publication_date"]')?.content?.substring(0, 4);

    metadata.abstract =
        document.querySelector('meta[name="citation_abstract"]')?.content ||
        document.querySelector('#abstracts .abstract')?.textContent?.trim();

    metadata.doi = document.querySelector('meta[name="citation_doi"]')?.content;

    metadata.venue = document.querySelector('meta[name="citation_journal_title"]')?.content;

    metadata.type = document.querySelector('meta[name="citation_journal_title"]') ? 'Journal' : 'Article';
    metadata.peerReviewed = true; // ScienceDirect papers are typically peer-reviewed

    return metadata;
}

// IEEE extractor
function extractIEEE(metadata) {
    metadata.title =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector('h1.document-title')?.textContent?.trim();

    const authorElements = document.querySelectorAll('meta[name="citation_author"]');
    metadata.authors = Array.from(authorElements).map(el => el.content).join(', ');

    metadata.year = document.querySelector('meta[name="citation_publication_date"]')?.content?.substring(0, 4);

    metadata.abstract =
        document.querySelector('meta[name="citation_abstract"]')?.content ||
        document.querySelector('.abstract-text')?.textContent?.trim();

    metadata.doi = document.querySelector('meta[name="citation_doi"]')?.content;

    metadata.venue =
        document.querySelector('meta[name="citation_conference_title"]')?.content ||
        document.querySelector('meta[name="citation_journal_title"]')?.content;

    metadata.peerReviewed = true;

    return metadata;
}

// Springer extractor
function extractSpringer(metadata) {
    metadata.title =
        document.querySelector('meta[name="citation_title"]')?.content ||
        document.querySelector('h1.c-article-title')?.textContent?.trim();

    const authorElements = document.querySelectorAll('meta[name="citation_author"]');
    metadata.authors = Array.from(authorElements).map(el => el.content).join(', ');

    metadata.year = document.querySelector('meta[name="citation_publication_date"]')?.content?.substring(0, 4);

    metadata.abstract =
        document.querySelector('meta[name="citation_abstract"]')?.content ||
        document.querySelector('#Abs1-content')?.textContent?.trim();

    metadata.doi = document.querySelector('meta[name="citation_doi"]')?.content;

    metadata.venue = document.querySelector('meta[name="citation_journal_title"]')?.content;

    metadata.peerReviewed = true;

    return metadata;
}

// Nature extractor
function extractNature(metadata) {
    metadata.title =
        document.querySelector('meta[name="citation_title"]')?.content ||
        document.querySelector('h1.c-article-title')?.textContent?.trim();

    const authorElements = document.querySelectorAll('meta[name="citation_author"]');
    metadata.authors = Array.from(authorElements).map(el => el.content).join(', ');

    metadata.year = document.querySelector('meta[name="citation_publication_date"]')?.content?.substring(0, 4);

    metadata.abstract =
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('#Abs1-content')?.textContent?.trim();

    metadata.doi = document.querySelector('meta[name="citation_doi"]')?.content;

    metadata.venue = 'Nature';
    metadata.peerReviewed = true;

    return metadata;
}

// ArXiv extractor
function extractArxiv(metadata) {
    metadata.title =
        document.querySelector('meta[name="citation_title"]')?.content ||
        document.querySelector('h1.title')?.textContent?.replace('Title:', '')?.trim();

    const authorElements = document.querySelectorAll('.authors a');
    metadata.authors = Array.from(authorElements).map(el => el.textContent.trim()).join(', ');

    const dateText = document.querySelector('.dateline')?.textContent;
    if (dateText) {
        const yearMatch = dateText.match(/\d{4}/);
        metadata.year = yearMatch ? yearMatch[0] : '';
    }

    metadata.abstract = document.querySelector('.abstract')?.textContent?.replace('Abstract:', '')?.trim();

    metadata.doi = document.querySelector('meta[name="citation_arxiv_id"]')?.content;

    metadata.venue = 'arXiv (Preprint)';
    metadata.peerReviewed = false; // ArXiv papers are preprints
    metadata.type = 'Preprint';

    return metadata;
}

// Generic extractor (fallback for other sites)
function extractGeneric(metadata) {
    // Try multiple methods to extract title
    metadata.title =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector('meta[name="citation_title"]')?.content ||
        document.querySelector('meta[name="dc.title"]')?.content ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.title;

    // Extract authors
    const authorMetas = document.querySelectorAll('meta[name="citation_author"], meta[name="dc.creator"], meta[name="author"]');
    if (authorMetas.length > 0) {
        metadata.authors = Array.from(authorMetas).map(meta => meta.content).join(', ');
    } else {
        // Fallback: try to find author elements in the page
        const authorElements = document.querySelectorAll('.author, .authors a, [class*="author"]');
        if (authorElements.length > 0) {
            metadata.authors = Array.from(authorElements)
                .slice(0, 10) // Limit to first 10
                .map(el => el.textContent.trim())
                .filter(text => text.length > 0 && text.length < 100)
                .join(', ');
        }
    }

    // Extract year
    metadata.year =
        document.querySelector('meta[name="citation_publication_date"]')?.content?.substring(0, 4) ||
        document.querySelector('meta[name="citation_year"]')?.content ||
        document.querySelector('meta[name="dc.date"]')?.content?.substring(0, 4) ||
        document.querySelector('meta[property="article:published_time"]')?.content?.substring(0, 4) ||
        '';

    // Extract abstract
    metadata.abstract =
        document.querySelector('meta[property="og:description"]')?.content ||
        document.querySelector('meta[name="citation_abstract"]')?.content ||
        document.querySelector('meta[name="dc.description"]')?.content ||
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('abstract, .abstract, #abstract, [class*="abstract"]')?.textContent?.trim() ||
        '';

    // Limit abstract length
    if (metadata.abstract.length > 1000) {
        metadata.abstract = metadata.abstract.substring(0, 997) + '...';
    }

    // Extract DOI
    metadata.doi =
        document.querySelector('meta[name="citation_doi"]')?.content ||
        document.querySelector('meta[name="dc.identifier"]')?.content?.match(/10\.\d{4,}/)?.[0] ||
        document.querySelector('a[href*="doi.org"]')?.href?.match(/10\.\d{4,}[^\s]*/)?.[0] ||
        '';

    // Extract venue/journal
    metadata.venue =
        document.querySelector('meta[name="citation_journal_title"]')?.content ||
        document.querySelector('meta[name="citation_conference_title"]')?.content ||
        document.querySelector('meta[name="dc.publisher"]')?.content ||
        document.querySelector('meta[name="citation_publisher"]')?.content ||
        '';

    // Try to detect if peer-reviewed
    const pageText = document.body.textContent.toLowerCase();
    metadata.peerReviewed =
        pageText.includes('peer review') ||
        pageText.includes('peer-review') ||
        !!document.querySelector('meta[name="citation_journal_title"]');

    // Detect paper type
    if (document.querySelector('meta[name="citation_conference_title"]')) {
        metadata.type = 'Conference Paper';
    } else if (document.querySelector('meta[name="citation_journal_title"]')) {
        metadata.type = 'Journal';
    } else if (pageText.includes('preprint')) {
        metadata.type = 'Preprint';
    }

    return metadata;
}

// Helper function to clean text
function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')
        .replace(/[\n\r\t]/g, ' ')
        .trim();
}

// Add a visual indicator when extension is active
function addExtensionIndicator() {
    if (document.getElementById('oxenlight-indicator')) return;

    const indicator = document.createElement('div');
    indicator.id = 'oxenlight-indicator';
    indicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 10px 15px;
        border-radius: 25px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 999999;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    indicator.innerHTML = '🎓 OXenLight Scholar Active';

    indicator.addEventListener('mouseenter', () => {
        indicator.style.transform = 'translateY(-2px)';
        indicator.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.3)';
    });

    indicator.addEventListener('mouseleave', () => {
        indicator.style.transform = 'translateY(0)';
        indicator.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });

    indicator.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openPopup' });
    });

    document.body.appendChild(indicator);

    // Auto-hide after 3 seconds
    setTimeout(() => {
        indicator.style.opacity = '0.7';
    }, 3000);
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addExtensionIndicator);
} else {
    addExtensionIndicator();
}