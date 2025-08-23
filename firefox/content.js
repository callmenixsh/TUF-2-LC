// Content script to detect problems and add LeetCode buttons
let leetcodeData = [];
let buttonContainer = null;

// Load the LeetCode data
async function loadLeetCodeData() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getLeetCodeData' });
        leetcodeData = response || [];
    } catch (error) {
        console.log('Loading from local data...');
        leetcodeData = [];
    }
}

function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateSimilarity(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

let SIMILARITY_THRESHOLD = 0.4;
if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('leetcode-helper-similarity-threshold');
    if (stored) SIMILARITY_THRESHOLD = parseFloat(stored);
}

function findMatchingProblems(pageText) {
    const matches = [];
    for (let i = 0; i < leetcodeData.length; i++) {
        const problem = leetcodeData[i];
        const similarity = calculateSimilarity(pageText, problem.title);
        if (similarity >= SIMILARITY_THRESHOLD) {
            matches.push({
                ...problem,
                matchType: similarity > 0.8 ? 'exact' : 'similar',
                confidence: similarity
            });
        }
    }
    matches.sort((a, b) => b.confidence - a.confidence);

    const uniqueMatches = [];
    const seenTitles = new Set();
    for (const match of matches) {
        const normalizedTitle = normalizeText(match.title);
        let isRedundant = false;
        for (const seenTitle of seenTitles) {
            if (calculateSimilarity(normalizedTitle, seenTitle) > 0.8) {
                isRedundant = true;
                break;
            }
        }
        if (!isRedundant) {
            uniqueMatches.push(match);
            seenTitles.add(normalizedTitle);
        }
    }
    return uniqueMatches;
}

function getProblemTitle() {
    const titleElement = document.querySelector(
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary'
    );
    console.log("Problem title found in getProblemTitle", titleElement);
    
    return titleElement ? titleElement.textContent.trim() : null;
}

function createButtonContainer() {
    if (buttonContainer) return buttonContainer;
    buttonContainer = document.createElement('div');
    buttonContainer.id = 'leetcode-helper-container';
    buttonContainer.className = 'leetcode-helper-floating';
    buttonContainer.style.display = 'none';
    document.body.appendChild(buttonContainer);
    return buttonContainer;
}

function createLeetCodeButton(problem) {
    const button = document.createElement('button');
    button.className = 'leetcode-helper-btn';
    button.innerHTML = `
    <div class="btn-content">
      <div class="btn-title">${problem.title}</div>
      <div class="btn-meta">
        <span class="difficulty ${problem.difficulty.toLowerCase()}">${problem.difficulty}</span>
        <span class="match-type">${problem.matchType} (${(problem.confidence * 100).toFixed(0)}%)</span>
      </div>
    </div>
    <div class="btn-arrow">→</div>
  `;
    button.addEventListener('click', () => {
        window.open(problem.url, '_blank');
    });
    return button;
}

function updateUI(matches) {
    const container = createButtonContainer();
    container.innerHTML = '';
    if (matches.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    const header = document.createElement('div');
    header.className = 'leetcode-helper-header';
    header.innerHTML = `
    <span>:dart: Found ${matches.length} LeetCode Match${matches.length > 1 ? 'es' : ''}!</span>
    <button class="close-btn" onclick="this.parentElement.parentElement.style.display='none'">×</button>
  `;
    container.appendChild(header);
    matches.forEach(problem => {
        const button = createLeetCodeButton(problem);
        container.appendChild(button);
    });
}

let currentUrl = window.location.href;

function createTitleButton() {
    const titleButton = document.createElement('button');
    titleButton.className = 'leetcode-helper-title-btn';
    titleButton.style.marginLeft = '8px'; // spacing inside span
    titleButton.style.cursor = 'pointer';
    titleButton.innerHTML = '🔍';
    titleButton.title = 'Find similar LeetCode problems';

    titleButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = getProblemTitle();
        if (title) {
            const matches = findMatchingProblems(title);
            updateUI(matches);
            const rect = titleButton.getBoundingClientRect();
            if (buttonContainer) {
                buttonContainer.style.top = `${rect.bottom + window.scrollY + 5}px`;
                buttonContainer.style.left = `${rect.left + window.scrollX}px`;
                buttonContainer.style.display = 'block';
            }
        }
    });
    return titleButton;
}

let visibilityEnabled = true;
if (typeof localStorage !== 'undefined') {
    const storedVisibility = localStorage.getItem('leetcode-helper-visibility-enabled');
    if (storedVisibility !== null) {
        visibilityEnabled = storedVisibility === 'true';
    }
}

function removeTitleButton() {
    const titleElement = document.querySelector(
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary'
    );
    if (titleElement) {
        console.log("Problem title found in removeTitleButton", titleElement);
        const btn = titleElement.querySelector('.leetcode-helper-title-btn');
        if (btn) btn.remove();
    }
    console.log("Problem title not found in removeTitleButton");
}

function hidePopup() {
    if (buttonContainer) buttonContainer.style.display = 'none';
}

function showPopup() {
    if (buttonContainer && buttonContainer.innerHTML.trim() !== '') {
        buttonContainer.style.display = 'block';
    }
}

function injectTitleButton() {
    if (!visibilityEnabled) {
        removeTitleButton();
        hidePopup();
        return;
    }
    const titleElement = document.querySelector(
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary'
    );
    if (titleElement && !titleElement.querySelector('.leetcode-helper-title-btn')) {
        console.log("Problem title found in injectTitleButton", titleElement);
        const titleButton = createTitleButton();
        // 🔑 append inside span so it sits inline
        titleElement.appendChild(titleButton);
    }
    console.log("Problem title not found in injectTitleButton");
}

function handleUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
        currentUrl = newUrl;
        if (buttonContainer) {
            buttonContainer.innerHTML = '';
            buttonContainer.style.display = 'none';
        }
        setTimeout(() => {
            injectTitleButton();
        }, 1000);
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function init() {
    await loadLeetCodeData();
    createButtonContainer();

    document.addEventListener('click', (e) => {
        if (buttonContainer && !buttonContainer.contains(e.target) &&
            !e.target.classList.contains('leetcode-helper-title-btn')) {
            buttonContainer.style.display = 'none';
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectTitleButton);
    } else {
        injectTitleButton();
    }

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleUrlChange();
    };
    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);

    const debouncedAnalyze = debounce(() => {
        injectTitleButton();
    }, 1000);

    const observer = new MutationObserver(() => {
        debouncedAnalyze();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refresh') {
        injectTitleButton();
        sendResponse({ success: true });
    }
    if (request.action === 'toggle') {
        visibilityEnabled = !visibilityEnabled;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('leetcode-helper-visibility-enabled', visibilityEnabled);
        }
        if (!visibilityEnabled) {
            removeTitleButton();
            hidePopup();
        } else {
            injectTitleButton();
        }
        sendResponse({ success: true, visible: visibilityEnabled });
    }
    if (request.action === 'setSimilarityThreshold') {
        SIMILARITY_THRESHOLD = parseFloat(request.value);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('leetcode-helper-similarity-threshold', SIMILARITY_THRESHOLD);
        }
        sendResponse({ success: true });
    }
    if (request.action === 'getSimilarityThreshold') {
        sendResponse({ value: SIMILARITY_THRESHOLD });
    }
});

init();
