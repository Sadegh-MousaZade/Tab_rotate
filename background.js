let config = null;
let currentTabIndex = 0;
let rotationInterval = null;
let reloadIntervals = {};
let isRotating = false;
let tabIds = []; // Track tab IDs for each URL

// Handle icon click to toggle rotation
chrome.action.onClicked.addListener(() => {
  if (isRotating) {
    stopRotation();
    chrome.action.setIcon({ path: 'icon.png' });
    isRotating = false;
  } else {
    chrome.storage.local.get(['configUrl'], (result) => {
      if (result.configUrl) {
        fetchConfigAndStart(result.configUrl, () => {
          chrome.action.setIcon({ path: 'icon-active.png' });
          isRotating = true;
        });
      } else {
        console.error('No config URL set');
      }
    });
  }
});

// Load and start rotation when message received
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRotation') {
    chrome.storage.local.get(['configUrl'], (result) => {
      if (!result.configUrl) {
        sendResponse({ status: 'error', error: 'No config URL set' });
        return;
      }
      fetchConfigAndStart(result.configUrl, sendResponse);
      chrome.action.setIcon({ path: 'icon-active.png' });
      isRotating = true;
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'stopRotation') {
    stopRotation();
    chrome.action.setIcon({ path: 'icon.png' });
    isRotating = false;
    sendResponse({ status: 'stopped' });
  }
});

// Fetch and validate config, then start rotation
async function fetchConfigAndStart(configUrl, sendResponse) {
  try {
    const response = await fetch(configUrl);
    config = await response.json();
    if (!validateConfig(config)) {
      sendResponse({ status: 'error', error: 'Invalid config format' });
      return;
    }
    
    // Apply global settings
    if (config.closeExistingTabs) {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => chrome.tabs.remove(tab.id));
      });
    }
    if (config.autoStart) {
      startRotation();
    }
    sendResponse({ status: 'started' });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

// Validate config
function validateConfig(config) {
  return config && config.websites && Array.isArray(config.websites) &&
    config.websites.every(site => 
      site.url && typeof site.url === 'string' &&
      site.duration && typeof site.duration === 'number' &&
      site.tabReloadIntervalSeconds && typeof site.tabReloadIntervalSeconds === 'number'
    );
}

// Start tab rotation
function startRotation() {
  if (!config || !config.websites.length) return;

  // Clear previous tab IDs
  tabIds = [];

  // Open initial tabs and store their IDs
  config.websites.forEach((site, index) => {
    chrome.tabs.create({ url: site.url, active: index === 0 }, (tab) => {
      tabIds[index] = tab.id; // Store tab ID
      if (!config.lazyLoadTabs) {
        setupReloadInterval(tab.id, site.tabReloadIntervalSeconds);
      }
    });
  });

  // Start rotation
  function rotateTabs() {
    if (!config || !config.websites.length) return;

    currentTabIndex = (currentTabIndex + 1) % config.websites.length;
    const tabId = tabIds[currentTabIndex];

    if (tabId) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // Tab might have been closed, recreate it
          chrome.tabs.create({ url: config.websites[currentTabIndex].url }, (newTab) => {
            tabIds[currentTabIndex] = newTab.id;
            chrome.tabs.update(newTab.id, { active: true });
            if (!config.lazyLoadTabs) {
              setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
            }
          });
        } else {
          chrome.tabs.update(tabId, { active: true });
        }
      });
    } else {
      // Tab ID not found, recreate tab
      chrome.tabs.create({ url: config.websites[currentTabIndex].url }, (newTab) => {
        tabIds[currentTabIndex] = newTab.id;
        chrome.tabs.update(newTab.id, { active: true });
        if (!config.lazyLoadTabs) {
          setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
        }
      });
    }

    // Clear previous interval and set new one based on current tab's duration
    if (rotationInterval) {
      clearInterval(rotationInterval);
    }
    rotationInterval = setInterval(rotateTabs, config.websites[currentTabIndex].duration * 1000);
  }

  // Start the first rotation
  rotationInterval = setInterval(rotateTabs, config.websites[currentTabIndex].duration * 1000);
}

// Setup reload interval for a tab
function setupReloadInterval(tabId, intervalSeconds) {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
  }
  reloadIntervals[tabId] = setInterval(() => {
    chrome.tabs.reload(tabId);
  }, intervalSeconds * 1000);
}

// Stop rotation
function stopRotation() {
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
  }
  Object.values(reloadIntervals).forEach(interval => clearInterval(interval));
  reloadIntervals = {};
  tabIds = [];
}

// Clean up intervals when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
    delete reloadIntervals[tabId];
  }
  // Update tabIds if a tab is closed
  const index = tabIds.indexOf(tabId);
  if (index !== -1) {
    tabIds[index] = null;
  }
});

// Add context menu to open options page
chrome.contextMenus.create({
  id: "openOptions",
  title: "Open Tab Rotate Options",
  contexts: ["action"]
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});