// Background service worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('OXenLight Scholar extension installed');
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
    console.log('OXenLight Scholar extension starting up');
});