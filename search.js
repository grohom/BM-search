// Global state - v2.0
let words = [];
let wordIndex = {};
let wordFreq = {};
let projects = [];
let currentResults = [];
let currentPage = 1;
const resultsPerPage = 50;

// Text preprocessing functions to match Python
function removeAccents(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text) {
    // Normalize: lowercase and remove accents
    text = removeAccents(text.toLowerCase());
    
    // Extract all sequences of letters and all sequences of digits
    const tokens = [];
    
    // Match all letter sequences (words)
    const wordMatches = text.matchAll(/[a-z]+/g);
    for (const match of wordMatches) {
        tokens.push(match[0]);
    }
    
    // Match all digit sequences (numbers)
    const numberMatches = text.matchAll(/[0-9]+/g);
    for (const match of numberMatches) {
        tokens.push(match[0]);
    }
    
    return tokens;
}

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const autocompleteDropdown = document.getElementById('autocomplete');
const loadingDiv = document.getElementById('loading');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const resultsInfo = document.getElementById('resultsInfo');
const resultsList = document.getElementById('resultsList');
const paginationTop = document.getElementById('paginationTop');
const paginationBottom = document.getElementById('paginationBottom');

let autocompleteTimeout;
let selectedAutocompleteIndex = -1;

// Load all data files
async function loadData() {
    try {
        loadingDiv.textContent = 'Loading word list...';
        const wordsResponse = await fetch('words.json');
        if (!wordsResponse.ok) {
            throw new Error(`Failed to load words.json: ${wordsResponse.status} ${wordsResponse.statusText}`);
        }
        words = await wordsResponse.json();
        
        loadingDiv.textContent = 'Loading word frequencies...';
        const freqResponse = await fetch('word_freq.json');
        if (!freqResponse.ok) {
            throw new Error(`Failed to load word_freq.json: ${freqResponse.status} ${freqResponse.statusText}`);
        }
        wordFreq = await freqResponse.json();
        
        loadingDiv.textContent = 'Loading word index...';
        const indexResponse = await fetch('word_index.json');
        if (!indexResponse.ok) {
            throw new Error(`Failed to load word_index.json: ${indexResponse.status} ${indexResponse.statusText}`);
        }
        wordIndex = await indexResponse.json();
        
        loadingDiv.textContent = 'Loading projects...';
        const projectsResponse = await fetch('projects.json');
        if (!projectsResponse.ok) {
            throw new Error(`Failed to load projects.json: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }
        projects = await projectsResponse.json();
        
        loadingDiv.style.display = 'none';
        showStatus(`Ready! Loaded ${words.length.toLocaleString()} unique words and ${projects.length.toLocaleString()} projects.`);
        
        // Enable search
        searchInput.disabled = false;
        searchButton.disabled = false;
    } catch (error) {
        loadingDiv.textContent = 'Error loading data: ' + error.message;
        loadingDiv.style.backgroundColor = '#ffebee';
        loadingDiv.style.color = '#c62828';
        console.error('Full error:', error);
    }
}

// Binary search to find first word matching prefix
function findFirstMatch(prefix) {
    prefix = prefix.toLowerCase();
    let left = 0;
    let right = words.length - 1;
    let result = -1;
    
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const word = words[mid].toLowerCase();
        
        if (word.startsWith(prefix)) {
            result = mid;
            right = mid - 1; // Continue searching left for first match
        } else if (word < prefix) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    return result;
}

// Get all words matching a prefix
function getMatchingWords(prefix, maxResults = 20) {
    if (!prefix) return [];
    
    const firstMatch = findFirstMatch(prefix);
    if (firstMatch === -1) return [];
    
    const matches = [];
    const prefixLower = prefix.toLowerCase();
    
    for (let i = firstMatch; i < words.length && matches.length < maxResults; i++) {
        if (words[i].toLowerCase().startsWith(prefixLower)) {
            matches.push(words[i]);
        } else {
            break;
        }
    }
    
    return matches;
}

// Show autocomplete suggestions
function showAutocomplete(query) {
    if (!query.trim()) {
        hideAutocomplete();
        return;
    }
    
    // Get caret position
    const caretPos = searchInput.selectionStart;
    
    // Find which token the caret is in
    const beforeCaret = query.substring(0, caretPos);
    const afterCaret = query.substring(caretPos);
    
    // Extract the current word being edited at caret position
    // Look backwards from caret to find word start
    let wordStart = caretPos;
    while (wordStart > 0 && /[a-z0-9]/i.test(query[wordStart - 1])) {
        wordStart--;
    }
    
    // Look forwards from caret to find word end
    let wordEnd = caretPos;
    while (wordEnd < query.length && /[a-z0-9]/i.test(query[wordEnd])) {
        wordEnd++;
    }
    
    // Extract the word at caret
    const wordAtCaret = query.substring(wordStart, wordEnd);
    
    // Tokenize to get the normalized version
    const tokens = tokenize(wordAtCaret);
    
    if (tokens.length === 0 || tokens[0].length < 2) {
        hideAutocomplete();
        return;
    }
    
    const currentToken = tokens[0];
    
    let matches = getMatchingWords(currentToken);
    
    if (matches.length === 0) {
        hideAutocomplete();
        return;
    }
    
    // Calculate total prefix frequency for each match
    const matchesWithFreq = matches.map(word => {
        const allMatchingWords = getMatchingWords(word, 10000);
        const totalFreq = allMatchingWords.reduce((sum, w) => sum + (wordFreq[w] || 0), 0);
        return { word, totalFreq };
    });
    
    // Sort by total prefix frequency (descending)
    matchesWithFreq.sort((a, b) => b.totalFreq - a.totalFreq);
    
    // Limit to top 20
    const topMatches = matchesWithFreq.slice(0, 20);
    
    // Build autocomplete HTML
    const html = topMatches.map((item, index) => {
        const highlighted = highlightPrefix(item.word, currentToken);
        
        return `<div class="autocomplete-item" data-index="${index}" data-word="${item.word}" data-word-start="${wordStart}" data-word-end="${wordEnd}">
            <span class="word-text">${highlighted}</span>
            <span class="word-freq">(${item.totalFreq.toLocaleString()})</span>
        </div>`;
    }).join('');
    
    autocompleteDropdown.innerHTML = html;
    autocompleteDropdown.classList.add('show');
    selectedAutocompleteIndex = -1;
    
    // Add click handlers
    document.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            const wordStart = parseInt(item.dataset.wordStart);
            const wordEnd = parseInt(item.dataset.wordEnd);
            selectAutocompleteItem(item.dataset.word, wordStart, wordEnd);
        });
    });
}

// Highlight the prefix in the word
function highlightPrefix(word, prefix) {
    const prefixLen = prefix.length;
    return `<strong>${word.substring(0, prefixLen)}</strong>${word.substring(prefixLen)}`;
}

// Hide autocomplete
function hideAutocomplete() {
    autocompleteDropdown.classList.remove('show');
    selectedAutocompleteIndex = -1;
}

// Select an autocomplete item
function selectAutocompleteItem(word, wordStart, wordEnd) {
    const currentInput = searchInput.value;
    
    // Check if there's already a space after wordEnd
    const hasSpaceAfter = wordEnd < currentInput.length && currentInput[wordEnd] === ' ';
    
    // Replace the word at the specified position
    const spaceToAdd = hasSpaceAfter ? '' : ' ';
    const newValue = currentInput.substring(0, wordStart) + word + spaceToAdd + currentInput.substring(wordEnd);
    searchInput.value = newValue;
    
    // Set caret position after the inserted word (and space if added)
    const newCaretPos = wordStart + word.length + spaceToAdd.length;
    searchInput.setSelectionRange(newCaretPos, newCaretPos);
    
    hideAutocomplete();
    searchInput.focus();
}

// Navigate autocomplete with keyboard
function navigateAutocomplete(direction) {
    const items = document.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;
    
    // Remove previous selection
    if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < items.length) {
        items[selectedAutocompleteIndex].classList.remove('selected');
    }
    
    // Update index
    if (direction === 'down') {
        selectedAutocompleteIndex = (selectedAutocompleteIndex + 1) % items.length;
    } else if (direction === 'up') {
        selectedAutocompleteIndex = selectedAutocompleteIndex <= 0 ? items.length - 1 : selectedAutocompleteIndex - 1;
    }
    
    // Add new selection
    items[selectedAutocompleteIndex].classList.add('selected');
    items[selectedAutocompleteIndex].scrollIntoView({ block: 'nearest' });
}

// Perform search
function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        showStatus('Please enter a search term.');
        resultsDiv.classList.remove('show');
        return;
    }
    
    hideAutocomplete();
    
    // Tokenize query
    const queryTokens = tokenize(query);
    
    if (queryTokens.length === 0) {
        showStatus('Please enter valid search terms (words or numbers).');
        resultsDiv.classList.remove('show');
        return;
    }
    
    // Find projects that contain ALL query tokens as prefixes
    const startTime = performance.now();
    const projectSets = [];
    
    for (const token of queryTokens) {
        // Find all dictionary words that start with this token (prefix match)
        const matchingWords = getMatchingWords(token, 1000);
        
        if (matchingWords.length === 0) {
            showStatus(`No words found starting with "${token}".`);
            resultsDiv.classList.remove('show');
            return;
        }
        
        // Collect all project indices for these words
        const projectIndices = new Set();
        for (const word of matchingWords) {
            const indices = wordIndex[word] || [];
            indices.forEach(idx => projectIndices.add(idx));
        }
        
        projectSets.push(projectIndices);
    }
    
    // Intersect all sets (projects must match ALL query tokens)
    let resultIndices = projectSets[0];
    for (let i = 1; i < projectSets.length; i++) {
        resultIndices = new Set([...resultIndices].filter(x => projectSets[i].has(x)));
    }
    
    // Convert to array and get project names
    currentResults = Array.from(resultIndices)
        .sort((a, b) => a - b)
        .map(idx => ({ index: idx, name: projects[idx] }));
    
    const endTime = performance.now();
    const searchTime = (endTime - startTime).toFixed(2);
    
    if (currentResults.length === 0) {
        showStatus(`No projects found matching all search terms. (${searchTime}ms)`);
        resultsDiv.classList.remove('show');
        return;
    }
    
    // Show results
    statusDiv.style.display = 'none';
    currentPage = 1;
    displayResults(searchTime);
}

// Display results with pagination
function displayResults(searchTime) {
    const totalResults = currentResults.length;
    const totalPages = Math.ceil(totalResults / resultsPerPage);
    const startIdx = (currentPage - 1) * resultsPerPage;
    const endIdx = Math.min(startIdx + resultsPerPage, totalResults);
    const pageResults = currentResults.slice(startIdx, endIdx);
    
    // Results info
    resultsInfo.textContent = `Found ${totalResults.toLocaleString()} projects in ${searchTime}ms. Showing ${startIdx + 1}-${endIdx} of ${totalResults.toLocaleString()}.`;
    
    // Results list
    const html = pageResults.map(result => 
        `<div class="result-item">
            <span class="result-number">Proj. id: ${result.index + 1}</span>
            <span class="result-name">${escapeHtml(result.name)}</span>
        </div>`
    ).join('');
    resultsList.innerHTML = html;
    
    // Pagination
    renderPagination(totalPages);
    
    resultsDiv.classList.add('show');
}

// Render pagination controls
function renderPagination(totalPages) {
    if (totalPages <= 1) {
        paginationTop.innerHTML = '';
        paginationBottom.innerHTML = '';
        return;
    }
    
    const buttons = [];
    
    // Previous button
    buttons.push(`<button class="page-button" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>`);
    
    // Page numbers
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        buttons.push(`<button class="page-button" onclick="goToPage(1)">1</button>`);
        if (startPage > 2) {
            buttons.push(`<span class="page-info">...</span>`);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        buttons.push(`<button class="page-button ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            buttons.push(`<span class="page-info">...</span>`);
        }
        buttons.push(`<button class="page-button" onclick="goToPage(${totalPages})">${totalPages}</button>`);
    }
    
    // Next button
    buttons.push(`<button class="page-button" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>`);
    
    const html = buttons.join('');
    paginationTop.innerHTML = html;
    paginationBottom.innerHTML = html;
}

// Go to specific page
function goToPage(page) {
    const totalPages = Math.ceil(currentResults.length / resultsPerPage);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    displayResults(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show status message
function showStatus(message) {
    statusDiv.textContent = message;
    statusDiv.classList.add('show');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
searchInput.addEventListener('input', (e) => {
    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(() => {
        showAutocomplete(e.target.value);
    }, 200);
});

// Update autocomplete when caret moves (click or arrow keys)
searchInput.addEventListener('click', (e) => {
    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(() => {
        showAutocomplete(e.target.value);
    }, 50);
});

// Update autocomplete when selection changes (arrow keys, home, end, etc.)
searchInput.addEventListener('selectionchange', (e) => {
    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(() => {
        showAutocomplete(searchInput.value);
    }, 50);
});

// Also handle keyup for arrow keys (left/right) when autocomplete is NOT showing
searchInput.addEventListener('keyup', (e) => {
    if (!autocompleteDropdown.classList.contains('show') && 
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
        clearTimeout(autocompleteTimeout);
        autocompleteTimeout = setTimeout(() => {
            showAutocomplete(searchInput.value);
        }, 50);
    }
});

searchInput.addEventListener('keydown', (e) => {
    if (autocompleteDropdown.classList.contains('show')) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateAutocomplete('down');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateAutocomplete('up');
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const items = document.querySelectorAll('.autocomplete-item');
            if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < items.length) {
                const item = items[selectedAutocompleteIndex];
                const wordStart = parseInt(item.dataset.wordStart);
                const wordEnd = parseInt(item.dataset.wordEnd);
                selectAutocompleteItem(item.dataset.word, wordStart, wordEnd);
            } else {
                performSearch();
            }
        } else if (e.key === 'Escape') {
            hideAutocomplete();
        }
    } else if (e.key === 'Enter') {
        performSearch();
    }
});

searchButton.addEventListener('click', performSearch);

// Hide autocomplete when clicking outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !autocompleteDropdown.contains(e.target)) {
        hideAutocomplete();
    }
});

// Initialize
loadData();
