let leetcodeData = [];
let buttonContainer = null;
let isSearching = false; 

async function loadLeetCodeData() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getLeetCodeData' });
        leetcodeData = response || [];
        console.log('Loaded LeetCode data:', leetcodeData.length, 'problems');
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
// Also check chrome.storage for consistency with popup
try {
    chrome.storage.local.get(['leetcode-helper-similarity-threshold'], (result) => {
        if (result['leetcode-helper-similarity-threshold']) {
            SIMILARITY_THRESHOLD = parseFloat(result['leetcode-helper-similarity-threshold']);
        }
    });
} catch (e) {
}

function findMatchingProblems(pageText) {
    console.log('Finding matches for:', pageText.substring(0, 100) + '...');
    
    const matches = [];
    const pageWords = new Set(normalizeText(pageText).split(/\s+/));
    const minThreshold = Math.max(0.15, SIMILARITY_THRESHOLD); // Ensure minimum threshold to prevent overload
    
    for (let i = 0; i < leetcodeData.length; i++) {
        const problem = leetcodeData[i];
        
        // Quick pre-filter: check if problem has any matching words
        const problemWords = new Set(normalizeText(problem.title).split(/\s+/));
        const hasCommonWords = [...pageWords].some(word => problemWords.has(word));
        
        if (!hasCommonWords && minThreshold > 0.3) {
            continue; // Skip if no common words and threshold is reasonable
        }
        
        const titleSimilarity = calculateSimilarity(pageText, problem.title);
        let descSimilarity = 0;
        
        if (problem.description && problem.description.trim()) {
            descSimilarity = calculateSimilarity(pageText, problem.description);
        }
        
        const combinedScore = (descSimilarity * 1.5) + (titleSimilarity * 0.8);
        
        if (combinedScore >= minThreshold || titleSimilarity >= minThreshold || descSimilarity >= minThreshold) {
            matches.push({
                ...problem,
                titleMatch: titleSimilarity,
                descMatch: descSimilarity,
                combinedScore: combinedScore,
                matchType: combinedScore > 0.8 ? 'exact' : 'similar',
                confidence: combinedScore
            });
        }
    }
    
    matches.sort((a, b) => b.combinedScore - a.combinedScore);

    // Deduplicate: remove redundant matches more efficiently
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
        
        // Hard limit to prevent excessive DOM manipulation
        if (uniqueMatches.length >= 30) break;
    }
    
    console.log('Found', uniqueMatches.length, 'unique matches');
    return uniqueMatches.slice(0, 20);
}

function getProblemTitle() {
    // Try multiple possible selectors to accommodate new UI frames
    const selectors = [
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary',
        'h1.text-xl.font-bold',
        'h1.text-2xl.font-bold',
        'h1.font-bold',
        '[data-problem-title]',
    ];
    let titleElement = null;
    for (const sel of selectors) {
        titleElement = document.querySelector(sel);
        if (titleElement) break;
    }
    if (!titleElement) {
        // Fallback: first bold heading in main content
        const fallback = document.querySelector('main h1, section h1, article h1');
        titleElement = fallback || null;
    }
    return titleElement ? titleElement.textContent.replace(/🔍|<svg.*?<\/svg>/g, '').trim() : null;
}

function getTUFProblemContent() {
    let content = '';
    
    const title = getProblemTitle();
    if (title) {
        content += title + ' ';
    }
    
    // Description container: support old and new UI structures
    const descSelectors = [
        '.mt-6.w-full.text-new_secondary.text-\\[14px\\].dark\\:text-zinc-200',
        '.tuf-text-14',
        '.tuf-example',
        '[data-problem-description]',
    ];
    let descriptionElement = null;
    for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el) { descriptionElement = el; break; }
    }
    if (!descriptionElement) {
        // Fallback: main content paragraphs
        descriptionElement = document.querySelector('main') || document.querySelector('article');
    }
    if (descriptionElement) {
        const paragraphs = descriptionElement.querySelectorAll('p, li');
        const descText = Array.from(paragraphs)
            .map(p => p.textContent.trim())
            .filter(text => text.length > 0)
            .join(' ');
        if (descText) {
            content += descText + ' ';
        }
    }
    
    // Constraints or bullets section
    const constraintsContainer = document.querySelector('.mt-4.flex.flex-col.gap-y-2.mb-24') ||
        document.querySelector('.tuf-dark-content-box') ||
        document.querySelector('[data-constraints]');
    if (constraintsContainer) {
        const constraintsList = constraintsContainer.querySelector('ul');
        if (constraintsList) {
            const constraints = Array.from(constraintsList.querySelectorAll('li'))
                .map(li => li.textContent.trim())
                .join(' ');
            
            if (constraints) {
                content += constraints;
            }
        }
    }
    
    const finalContent = content.trim();
    console.log('TUF Content extracted:', finalContent.substring(0, 200) + '...');
    return finalContent;
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

function closeSearchResults() {
    if (buttonContainer) {
        buttonContainer.style.display = 'none';
        buttonContainer.innerHTML = '';
    }
}

function showLoadingScreen(titleButton) {
    const container = createButtonContainer();
    container.innerHTML = `
        <div class="leetcode-helper-header">
            <span>Searching for matches...</span>
        </div>
        <div class="loading-container">
            <div class="loading-text">
                <p>Analyzing problem content...</p>
                <p class="loading-subtext">Checking ${leetcodeData.length} LeetCode problems</p>
            </div>
        </div>
    `;
    // Position below button immediately
    if (titleButton) {
        const rect = titleButton.getBoundingClientRect();
        container.style.top = `${rect.bottom + window.scrollY + 5}px`;
        container.style.left = `${rect.left + window.scrollX}px`;
    }
    container.style.display = 'block';
}

function createLeetCodeButton(problem) {
    const button = document.createElement('button');
    button.className = 'leetcode-helper-btn';
    
    if (problem.isPremium) {
        button.classList.add('premium-problem');
    }
    
    const sqlBadge = problem.is_sql ? '<span class="sql-badge">SQL</span>' : '';
    const premiumBadge = problem.isPremium ? '<span class="premium-badge">PREMIUM</span>' : '';
    
    const titlePercent = Math.round(problem.titleMatch * 100);
    const descPercent = Math.round(problem.descMatch * 100);
    const totalPercent = Math.round(problem.combinedScore * 100);
    
    const topicTags = problem.topics.slice(0, 4).map(topic => 
        `<span class="topic-tag">${topic}</span>`
    ).join('');
    
    button.innerHTML = `
    <div class="btn-content">
      <div class="btn-title">${problem.title} ${sqlBadge}</div>
      <div class="btn-meta">
        <span class="difficulty ${problem.difficulty.toLowerCase()}">${problem.difficulty}</span>
        <span class="match-percent total-match">${totalPercent}% Matched</span>
        <span class="match-percent desc-match">${descPercent}% Desc Match</span>
        <span class="match-percent title-match">${titlePercent}% Title Match</span>
        ${premiumBadge}
      </div>
      <div class="btn-topics-line">
        ${topicTags}
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
    
    // Stop border animation by adding loaded class
    const loadingContainer = container.querySelector('.loading-container');
    if (loadingContainer) {
        loadingContainer.classList.add('loaded');
    }
    
    // Store last search results count
    try {
        chrome.storage.local.set({ lastSearchResults: matches.length });
    } catch (e) {
    }
    
    const content = document.createElement('div');
    content.className = 'results-content';
    
    container.innerHTML = '';
    
    if (matches.length === 0) {
        container.innerHTML = `
            <div class="leetcode-helper-header">
                <span>No matches found</span>
                <button class="close-btn" onclick="this.parentElement.parentElement.style.display='none'">×</button>
            </div>
            <div class="results-content">
                <div class="no-matches">
                    <p>No similar problems found.</p>
                    <p class="no-matches-subtext">Try adjusting the similarity threshold in the popup.</p>
                </div>
            </div>
        `;
        container.style.display = 'block';
        return;
    }
    
    container.style.display = 'block';
    const header = document.createElement('div');
    header.className = 'leetcode-helper-header';
    header.innerHTML = `
    <span>Found Match${matches.length > 1 ? 'es' : ''} on Leetcode!</span>
    <button class="close-btn" onclick="this.parentElement.parentElement.style.display='none'">×</button>
  `;
    
    container.appendChild(header);
    container.appendChild(content);
    
    matches.forEach(problem => {
        const button = createLeetCodeButton(problem);
        content.appendChild(button);
    });
}

let currentUrl = window.location.href;

function createTitleButton() {
    const titleButton = document.createElement('button');
    titleButton.className = 'leetcode-helper-title-btn';
    titleButton.style.marginLeft = '8px';
    titleButton.style.cursor = 'pointer';
    
    // Create SVG search icon
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '8');
    svg.appendChild(circle);
    
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '21');
    line.setAttribute('y1', '21');
    line.setAttribute('x2', '16.65');
    line.setAttribute('y2', '16.65');
    svg.appendChild(line);
    
    titleButton.appendChild(svg);
    titleButton.title = 'Find similar LeetCode problems (description-prioritized matching)';

    titleButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (isSearching) return;
        
        isSearching = true;
        titleButton.style.opacity = '0.6';
        titleButton.style.pointerEvents = 'none';
        
        try {
            showLoadingScreen(titleButton);
            
            const content = getTUFProblemContent();
            if (content) {
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const matches = await findMatchingProblems(content);
                updateUI(matches);
                
                // Position is already set by showLoadingScreen
                if (buttonContainer) {
                    buttonContainer.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            updateUI([]);
        } finally {
            isSearching = false;
            titleButton.style.opacity = '1';
            titleButton.style.pointerEvents = 'auto';
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
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary, h1.text-xl.font-bold, h1.text-2xl.font-bold, h1.font-bold, [data-problem-title]'
    );
    if (titleElement) {
        const btn = titleElement.querySelector('.leetcode-helper-title-btn');
        if (btn) btn.remove();
    }
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
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary, h1.text-xl.font-bold, h1.text-2xl.font-bold, h1.font-bold, [data-problem-title]'
    );
    if (titleElement && !titleElement.querySelector('.leetcode-helper-title-btn')) {
        const titleButton = createTitleButton();
        titleElement.appendChild(titleButton);
    }
}

function handleUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
        currentUrl = newUrl;
        
        closeSearchResults();
        
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
            closeSearchResults();
        }
    });

    document.addEventListener('scroll', () => {
        closeSearchResults();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') {
            closeSearchResults();
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

    const observer = new MutationObserver((mutations) => {
        let significantChange = false;
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && 
                        (node.classList?.contains('mt-6') || 
                         node.classList?.contains('text-2xl') ||
                         node.tagName === 'MAIN' ||
                         node.tagName === 'SECTION')) {
                        significantChange = true;
                        break;
                    }
                }
            }
        });
        
        if (significantChange) {
            closeSearchResults();
        }
        
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
    if (request.action === 'getToggleState') {
        sendResponse({ enabled: visibilityEnabled });
    }
    if (request.action === 'getProblemCount') {
        sendResponse({ count: leetcodeData.length });
    }
});

init();
