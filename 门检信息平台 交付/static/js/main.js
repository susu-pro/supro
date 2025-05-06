// static/js/main.js
document.addEventListener('DOMContentLoaded', function() {
    console.log("[Init] DOMContentLoaded event fired.");

    let currentTaskId = null;
    let currentMessagesPage = 1;
    let currentSearchPage = 1;
    let currentSearchQuery = '';
    let currentFavoritesPage = 1;
    let taskCheckInterval = null;
    let currentCallExcelId = localStorage.getItem('lastCallExcelId'); // Load from storage on init
    let currentCallChartId = null;

    console.log("[Init] Acquiring DOM elements...");
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const uploadForm = document.getElementById('uploadForm'); // Assuming form exists
    const fileInput = document.getElementById('fileInput'); // Assuming input exists
    const uploadStatus = document.getElementById('uploadStatus');
    const searchButton = document.querySelector('#searchTab #searchButton');
    const keywordSearch = document.getElementById('keywordSearch');
    const searchResultsContainer = document.getElementById('searchResults');
    const searchHistoryContainer = document.getElementById('searchHistory'); // Changed from searchHistoryList
    const searchPaginationContainer = document.getElementById('searchPagination'); // Added
    // const clearHistoryButton = document.getElementById('clearHistoryButton'); // Button is now inside searchHistoryContainer
    const favoritesListContainer = document.getElementById('favoritesList'); // Changed from favoritesList
    const favoritesPaginationContainer = document.getElementById('favoritesPagination'); // Changed from favoritesNavigation
    const messagesListContainer = document.getElementById('messagesList'); // Changed from messagesListEl
    const messagesPaginationContainer = document.getElementById('messagesPagination'); // Changed from messagesNavigationEl

    // Elements for Call Records Tab
    const callRecordsTab = document.getElementById('callRecordsTab');
    const callSummaryStatsEl = document.getElementById('callSummaryStats');
    const callChartContainerEl = document.getElementById('callChartContainer');
    const callChartImageEl = document.getElementById('callChartImage');
    const callTopContactsListEl = document.getElementById('callTopContactsList');
    const updateCallChartBtn = document.getElementById('updateCallChartBtn');
    const callNumThresholdInput = document.getElementById('callNumThreshold');
    const downloadCallExcelBtn = document.getElementById('downloadCallExcelBtn');
    const downloadCallChartBtn = document.getElementById('downloadCallChartBtn');

    console.log("[Init] DOM elements acquired.");

    try {
        console.log("[Init] Running initial setup functions...");
        setupTabs();
        setupUploadControls(); // Renamed from setupUploadForm
        setupSearchHistory();
        setupSearchControls();
        setupCallRecordControls(); // Add setup for call record controls
        console.log("[Init] Initial setup functions completed.");
    } catch (error) {
        console.error("[Init] CRITICAL Error during initial setup:", error);
        if(uploadStatus) uploadStatus.innerHTML = `<p class="error">页面初始化错误: ${error.message}.</p>`;
        // alert(`页面初始化时发生严重错误: ${error.message}`);
    }

    function setupTabs() {
        console.log("[Tabs] Setting up tabs...");
        if (!tabButtons || tabButtons.length === 0) { console.warn("[Tabs] No tab buttons found."); return; }
        tabButtons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);

            newButton.addEventListener('click', function() {
                console.log(`[Tabs] Tab clicked: ${this.getAttribute('data-tab')}`);
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                this.classList.add('active');
                const tabId = this.getAttribute('data-tab');
                const activeTabContent = document.getElementById(tabId);
                if (activeTabContent) {
                    activeTabContent.classList.add('active');
                    if (tabId === 'favoritesTab') loadFavorites(1);
                    if (tabId === 'messagesTab') loadMessages(1); // Load messages when tab clicked
                    if (tabId === 'searchTab') loadSearchHistory();
                    if (tabId === 'callRecordsTab') {
                        if (currentCallExcelId) {
                             loadCallRecordData(currentCallExcelId);
                        } else {
                             showCallError('请先上传包含通话记录的JSON文件并等待处理完成。');
                        }
                    }
                } else { console.error(`[Tabs] Tab content id '${tabId}' not found.`); }
            });
        });
        const initialTabButton = document.querySelector('.tab-button[data-tab="searchTab"]') || document.querySelector('.tab-button');
        if(initialTabButton) {
             console.log(`[Tabs] Activating initial tab: ${initialTabButton.getAttribute('data-tab')}`);
             const newInitialButton = Array.from(document.querySelectorAll('.tab-button')).find(btn => btn.getAttribute('data-tab') === initialTabButton.getAttribute('data-tab'));
             if (newInitialButton) newInitialButton.click();
             else initialTabButton.click();
        } else { console.warn("[Tabs] No initial tab button found."); }
        console.log("[Tabs] Tabs setup complete.");
    }

    function setupUploadControls() {
        console.log("[Upload] Setting up upload controls...");
        const uploadButton = document.getElementById('uploadButton'); // From test.html
        const clearButton = document.getElementById('clearButton'); // From test.html
        const dropArea = document.getElementById('dropArea'); // From test.html

        if (uploadButton && fileInput) {
             uploadButton.addEventListener('click', handleUpload);
        } else { console.error("[Upload] Upload button or file input not found."); }

        if (clearButton && fileInput) {
             clearButton.addEventListener('click', () => {
                 fileInput.value = '';
                 resetUploadArea();
                 if(processStatus) processStatus.classList.remove('active');
             });
        } else { console.error("[Upload] Clear button or file input not found."); }

        if (dropArea && fileInput) {
             ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                 dropArea.addEventListener(eventName, preventDefaults, false);
             });
             ['dragenter', 'dragover'].forEach(eventName => {
                 dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
             });
             ['dragleave', 'drop'].forEach(eventName => {
                 dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
             });
             dropArea.addEventListener('drop', handleDrop, false);
             fileInput.addEventListener('change', () => updateFileInfo(fileInput.files));
        } else { console.error("[Upload] Drop area or file input not found."); }

        console.log("[Upload] Upload controls setup complete.");
    }

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    function handleDrop(e) {
        const files = e.dataTransfer.files;
        if (fileInput) fileInput.files = files;
        updateFileInfo(files);
    }

    function updateFileInfo(files) {
        const dropArea = document.getElementById('dropArea');
        const uploadButton = document.getElementById('uploadButton');
        if (!dropArea || !uploadButton) return;

        if (files && files.length > 0) {
            const fileNames = Array.from(files).map(file => escapeHtml(file.name)).join(', ');
            dropArea.innerHTML = `<i class="fas fa-file-alt"></i><div class="drop-text">已选择 ${files.length} 个文件</div><div class="drop-hint">${fileNames}</div>`;
            uploadButton.disabled = false;
        } else {
            resetUploadArea();
        }
    }

    function resetUploadArea() {
        const dropArea = document.getElementById('dropArea');
        const uploadButton = document.getElementById('uploadButton');
        if (!dropArea || !uploadButton) return;
        dropArea.innerHTML = `<i class="fas fa-file-upload"></i><div class="drop-text">点击选择或拖放文件到此处</div><div class="drop-hint">支持 JSON 格式文件，最大上传大小: 20GB</div>`;
        uploadButton.disabled = true;
    }

    function handleUpload() {
        console.log("[Upload] Upload button clicked.");
        if (!fileInput) { console.error("[Upload] File input not found for upload."); return; }
        const files = fileInput.files;
        if (!files || files.length === 0) { if(uploadStatus) uploadStatus.innerHTML = '<p class="error">请选择文件。</p>'; return; }

        const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length !== files.length) { if(uploadStatus) uploadStatus.innerHTML = '<p class="error">请确保所有文件都是 .json 格式。</p>'; return; }

        const formData = new FormData();
        jsonFiles.forEach(file => formData.append('files[]', file));
        console.log("[Upload] FormData created with JSON files.");

        if(processStatus) processStatus.classList.add('active');
        const progressBar = document.getElementById('progressBar');
        const progressPercent = document.getElementById('progressPercent');
        const statusText = document.getElementById('statusText');
        if(progressBar) progressBar.style.width = '0%';
        if(progressPercent) progressPercent.textContent = '0%';
        if(statusText) statusText.textContent = '正在上传文件...';
        const uploadButton = document.getElementById('uploadButton');
        if(uploadButton) uploadButton.disabled = true;

        if (taskCheckInterval) { console.log("[Upload] Clearing previous task check interval."); clearInterval(taskCheckInterval); taskCheckInterval = null; }

        console.log("[Upload] Initiating fetch to /api/start-processing...");
        fetch('/api/start-processing', { method: 'POST', body: formData })
            .then(response => {
                 console.log(`[Upload] Fetch response status: ${response.status}`);
                 if (!response.ok) { return response.json().catch(() => null).then(errData => { throw new Error(`上传失败 (${response.status}): ${errData?.message || response.statusText}`); }); }
                 return response.json();
            })
            .then(data => {
                 console.log("[Upload] Parsed fetch response data:", data);
                if (data.status === 'started' && data.task_id) {
                    currentTaskId = data.task_id;
                    console.log(`[Upload] Processing started. Task ID: ${currentTaskId}. Starting status polling.`);
                    checkTaskStatus(currentTaskId);
                    taskCheckInterval = setInterval(() => checkTaskStatus(currentTaskId), 2000);
                } else {
                    const errorMsg = data.message || '启动处理失败。';
                    console.error(`[Upload] API returned non-started status: ${data.status} - ${errorMsg}`);
                    if(statusText) statusText.textContent = `错误: ${errorMsg}`;
                    if(uploadButton) uploadButton.disabled = false;
                    if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null;
                }
            })
            .catch(error => {
                 console.error("[Upload] Fetch request failed:", error);
                 if(statusText) statusText.textContent = `上传请求失败: ${error.message}`;
                 if(uploadButton) uploadButton.disabled = false;
                 if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null;
            });
    }

    function checkTaskStatus(taskId) {
        if (!taskId) { if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; return; }
        console.log(`[StatusCheck] Checking status for Task ID: ${taskId}`);
        fetch(`/api/task-status/${taskId}`)
            .then(response => {
                 console.log(`[StatusCheck] Task status response status: ${response.status}`);
                 if (!response.ok) { if (response.status === 404) { console.error(`[StatusCheck] Task ${taskId} not found (404). Stopping polling.`); if(uploadStatus) uploadStatus.innerHTML = `<p class="error">任务 ${taskId} 未找到。</p>`; if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; } throw new Error(`HTTP error! status: ${response.status}`); }
                 return response.json();
             })
            .then(data => {
                console.log("[StatusCheck] Task status data:", data);
                const progressBar = document.getElementById('progressBar');
                const progressPercent = document.getElementById('progressPercent');
                const statusText = document.getElementById('statusText');
                const processedFilesEl = document.getElementById('processedFiles');
                const successFilesEl = document.getElementById('successFiles');
                const failedFilesEl = document.getElementById('failedFiles');
                const uploadButton = document.getElementById('uploadButton');

                if (data.status === 'error') { console.error(`[StatusCheck] Task ${taskId} failed: ${data.error}`, data.batch_errors); let errorMsg = `<p class="error">处理失败: ${data.error || '未知错误'}</p>`; if (data.batch_errors?.length > 0) { errorMsg += '<ul class="error">'; data.batch_errors.forEach(err => errorMsg += `<li>${escapeHtml(err)}</li>`); errorMsg += '</ul>'; } if(statusText) statusText.innerHTML = errorMsg; if(uploadButton) uploadButton.disabled = false; if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; return; }
                if (data.status === 'completed') {
                    console.log(`[StatusCheck] Task ${taskId} completed. Clearing interval.`);
                    if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null;
                    if(statusText) { let message = `<p class="success">处理完成!</p>`; statusText.innerHTML = message; }
                    if(progressBar) progressBar.style.width = '100%';
                    if(progressPercent) progressPercent.textContent = '100%';
                    if(processedFilesEl) processedFilesEl.textContent = data.total_files || 0;
                    if(successFilesEl) successFilesEl.textContent = data.success_files || 0;
                    if(failedFilesEl) failedFilesEl.textContent = data.failed_files || 0;
                    if(uploadButton) uploadButton.disabled = false;
                    console.log("[StatusCheck] Task complete. Calling updateStats()...");
                    updateStats(); // Update overall stats after completion

                    // --- Call Record Handling ---
                    // Assuming the backend task status endpoint returns the generated excel_id on completion
                    const generatedExcelId = data.result_files?.excel; // Adjust based on actual API response structure
                    if (generatedExcelId) {
                        handleSuccessfulUpload(taskId, generatedExcelId, data.result_files?.chart); // Pass chart ID too if available
                    } else {
                        console.warn("[StatusCheck] Task completed but no Excel ID found in response for call records.");
                    }
                    // --- End Call Record Handling ---

                    return;
                }

                const progress = data.progress !== undefined ? Math.round(data.progress) : 0;
                if (progressBar) progressBar.style.width = `${progress}%`;
                if (progressPercent) progressPercent.textContent = `${progress}%`;
                if (processedFilesEl) processedFilesEl.textContent = data.processed_files || 0;
                if (successFilesEl) successFilesEl.textContent = data.success_files || 0;
                if (failedFilesEl) failedFilesEl.textContent = data.failed_files || 0;

                if (statusText) {
                    let statusMsg = `处理中... ${data.processed_files || 0}/${data.total_files || 0} 文件 (${progress}%)`;
                    if (data.total_batches > 0) statusMsg += ` - 批次 ${data.current_batch || 0}/${data.total_batches}`;
                    statusText.textContent = statusMsg;
                }

                if (!['processing', 'queued', 'processing_batch'].includes(data.status)) { console.warn(`[StatusCheck] Unexpected task status '${data.status}'. Stopping polling.`); if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; }
            })
            .catch(error => { console.error(`[StatusCheck] Error fetching task status for ${taskId}:`, error); });
    }

    function setupSearchHistory() {
        console.log("[History] Setting up search history...");
        loadSearchHistory();
        if (searchHistoryContainer) {
            searchHistoryContainer.addEventListener('click', function(e) {
                if (e.target.classList.contains('history-item')) {
                    const query = e.target.getAttribute('data-query');
                    console.log(`[History] Search history item clicked: "${query}"`);
                    if (keywordSearch) { keywordSearch.value = query; }
                    startSearch();
                } else if (e.target.id === 'clearHistoryBtn' || e.target.closest('#clearHistoryBtn')) {
                    clearSearchHistory();
                }
            });
        }
        console.log("[History] Search history setup complete.");
    }

    function loadSearchHistory() {
        if (!searchHistoryContainer) return;
        console.log("[History] Loading search history...");
        fetch('/api/search-history')
            .then(response => response.json())
            .then(data => {
                console.log("[History] Search history data:", data);
                const historyItems = data.search_history || [];
                if (historyItems.length === 0) {
                    searchHistoryContainer.style.display = 'none'; return;
                }
                searchHistoryContainer.style.display = 'block';
                let historyHTML = `<div class="search-history-header"><div class="search-history-title"><i class="fas fa-history"></i> 搜索历史</div><button class="clear-history-btn" id="clearHistoryBtn"><i class="fas fa-trash-alt"></i> 清空</button></div><div class="search-history-items">`;
                historyItems.slice(0, 10).forEach(item => {
                    historyHTML += `<div class="history-item" data-query="${escapeHtml(item)}"><i class="fas fa-search"></i> ${escapeHtml(item)}</div>`;
                });
                historyHTML += '</div>';
                searchHistoryContainer.innerHTML = historyHTML;
            })
            .catch(error => { console.error("[History] Load search history error:", error); searchHistoryContainer.style.display = 'none'; });
    }

    function clearSearchHistory() {
        if(!confirm("确定要清空所有搜索历史吗？")) return;
        console.log("[History] Clearing search history...");
        fetch('/api/search-history/clear', {method:'POST'})
            .then(r => r.json())
            .then(d => { if(d.status === 'success') { console.log("[History] Search history cleared."); loadSearchHistory(); } else { alert('清空搜索历史失败: '+(d.message||'未知错误')); console.error("[History] Clear history API error:", d.message); } })
            .catch(e => { alert('清空搜索历史请求失败'); console.error("[History] Clear history fetch error:", e); });
    }

    function setupSearchControls() {
        console.log("[Search] Setting up search controls...");
        if (searchButton) { searchButton.addEventListener('click', startSearch); }
        if (keywordSearch) {
            keywordSearch.addEventListener('keypress', function(e){ if(e.key === 'Enter') startSearch(); });
            keywordSearch.addEventListener('focus', loadSearchHistorySuggestions);
        }
        const historySuggestionsContainer = document.getElementById('searchHistorySuggestions'); // This is the history list itself now
        if (historySuggestionsContainer) {
            // Event delegation handled in setupSearchHistory
            document.addEventListener('click', function(e){
                if (keywordSearch && historySuggestionsContainer && !keywordSearch.contains(e.target) && !historySuggestionsContainer.contains(e.target)) {
                     // If suggestions dropdown exists separately, hide it here
                     // const suggestionsDropdown = document.getElementById('suggestionsDropdown');
                     // if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
                }
            });
        }
        console.log("[Search] Search controls setup complete.");
    }

     function loadSearchHistorySuggestions() {
         // This function might load suggestions into a *different* container
         // than the search history list if you want both.
         // For now, it reuses the history container logic.
         const container = document.getElementById('searchSuggestions'); // Use a separate container for suggestions
         if (!container) return;
         fetch('/api/search-history')
             .then(r => r.json())
             .then(d => {
                 if(d.search_history?.length > 0) {
                     container.innerHTML = d.search_history.slice(0, 5).map(i => `<div class="suggestion-item" data-query="${escapeHtml(i)}">${escapeHtml(i)}</div>`).join('');
                     container.classList.add('show'); // Use class to show/hide
                     // Add click listener for suggestion items
                     container.querySelectorAll('.suggestion-item').forEach(item => {
                         item.addEventListener('click', function() {
                             if (keywordSearch) keywordSearch.value = this.getAttribute('data-query');
                             container.classList.remove('show');
                             startSearch();
                         });
                     });
                 } else {
                     container.classList.remove('show');
                 }
             })
             .catch(e => { console.error("[Search] Suggest load error", e); if(container) container.classList.remove('show'); });
     }

    function startSearch() {
        currentSearchPage = 1;
        currentSearchQuery = keywordSearch ? keywordSearch.value.trim() : '';
        const searchTypeSelect = document.getElementById('searchTypeSelect');
        const currentSearchType = searchTypeSelect ? searchTypeSelect.value : 'combined';
        console.log(`[Search] Starting search: Query="${currentSearchQuery}", Type=${currentSearchType}`);
        if (!currentSearchQuery) { if (searchResultsContainer) searchResultsContainer.innerHTML = '<p>请输入搜索关键词。</p>'; return; }
        if (searchResultsContainer) showLoadingIndicator(searchResultsContainer, '搜索中...');
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if(suggestionsContainer) suggestionsContainer.classList.remove('show');
        performSearch(currentSearchQuery, currentSearchType, currentSearchPage);
    }

    function performSearch(query, type, page) {
        if (!searchResultsContainer) return;
        console.log(`[Search] Performing search API call: Query="${query}", Type=${type}, Page=${page}`);
        const apiUrl = `/api/search?q=${encodeURIComponent(query)}&page=${page}&page_size=20&type=${type}&context_size=3`;
        fetch(apiUrl)
            .then(response => { if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); return response.json(); })
            .then(data => { console.log("[Search] Search results data:", data); displaySearchResults(data); })
            .catch(error => { showError(searchResultsContainer, `搜索出错: ${error.message}`); console.error('[Search] Search error:', error); });
    }

    function displaySearchResults(data) {
        if (!searchResultsContainer) return;
        const results = data.results || [];
        if (results.length === 0 && data.page === 1) { showNoResults(searchResultsContainer, `没有找到与 "<strong>${escapeHtml(data.query)}</strong>" 相关的结果。`); return; }

        let resultsHTML = '';
        if (data.page === 1) { const typeMap={'combined':'混合','keyword':'关键词','semantic':'语义','sender':'发送者'}; resultsHTML += `<div class="results-summary">找到 ${formatNumber(data.total||0)} 个结果 (搜索类型: ${typeMap[data.search_type]||data.search_type})</div>`; }
        resultsHTML += '<div class="results-list">';
        results.forEach(result => { if (!result || !result.data) { console.warn("[Search] Invalid search result:", result); return; } resultsHTML += renderResultItem(result.data, false); });
        resultsHTML += '</div>';

        searchResultsContainer.innerHTML = resultsHTML;
        renderPagination(data.page, data.total_pages, searchPaginationContainer, (newPage) => { currentSearchPage = newPage; performSearch(currentSearchQuery, document.getElementById('searchTypeSelect')?.value || 'combined', newPage); });
        addInteractiveListeners(searchResultsContainer, false);
    }

    function loadFavorites(page) {
        currentFavoritesPage = page;
        if (!favoritesListContainer || !favoritesPaginationContainer) return;
        console.log(`[Favorites] Loading favorites page ${page}...`);
        showLoadingIndicator(favoritesListContainer);
        favoritesPaginationContainer.innerHTML = '';
        fetch(`/api/favorites?page=${page}&page_size=10`) // Smaller page size for favorites
            .then(r => r.json())
            .then(d => {
                console.log("[Favorites] Favorites data received:", d);
                if (!d.results || d.results.length === 0) { showNoResults(favoritesListContainer, "收藏夹是空的"); return; }
                let h = `<div class="results-summary">共 ${formatNumber(d.total)} 个收藏项 (第 ${d.page}/${d.total_pages} 页)</div><div class="results-list">`;
                d.results.forEach(r => { if (!r || !r.data) { console.warn("[Favorites] Invalid favorite item:", r); return; } h += renderResultItem(r.data, true); });
                h += '</div>';
                favoritesListContainer.innerHTML = h;
                renderPagination(d.page, d.total_pages, favoritesPaginationContainer, loadFavorites);
                console.log("[Favorites] Calling addInteractiveListeners for favorites list...");
                addInteractiveListeners(favoritesListContainer, true);
            })
            .catch(e => { showError(favoritesListContainer, `加载收藏夹失败: ${e.message}`); console.error("[Favorites] Load favorites error:", e); });
    }

    function addFavorite(type, id, buttonElement) {
         console.log(`[Favorites] Adding favorite: type=${type}, id=${id}, query=${currentSearchQuery}`);
         fetch('/api/favorites/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id, query: currentSearchQuery }) })
         .then(r=>r.json()).then(d=>{ console.log("[Favorites] Add favorite response:", d); if (d.status==='success'||d.status==='info') { if (buttonElement) updateFavoriteButton(buttonElement, true); const favTab=document.querySelector('.tab-button[data-tab="favoritesTab"]'); if(favTab?.classList.contains('active')) loadFavorites(currentFavoritesPage); } else { alert('添加收藏失败: '+(d.message||'未知错误')); } }).catch(e=>{ alert('添加收藏请求失败'); console.error("[Favorites] Add favorite error:", e); });
    }

    function removeFavorite(type, id, buttonElement, isInFavoritesList = false) {
         console.log(`[Favorites] Removing favorite: type=${type}, id=${id}, fromFavoritesList=${isInFavoritesList}`);
         fetch('/api/favorites/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id }) })
         .then(r=>r.json()).then(d=>{ console.log("[Favorites] Remove favorite response:", d); if (d.status==='success') { if(isInFavoritesList){ const itemEl=buttonElement.closest('.result-item'); if(itemEl){ itemEl.remove(); console.log("[Favorites] Removed item from favorites list display."); if(favoritesListContainer&&favoritesListContainer.querySelectorAll('.result-item').length===0) loadFavorites(currentFavoritesPage); } } else { if(buttonElement) updateFavoriteButton(buttonElement, false); } } else { alert('移除收藏失败: '+(d.message||'未知错误')); } }).catch(e=>{ alert('移除收藏请求失败'); console.error("[Favorites] Remove favorite error:", e); });
    }

    function handleAddFavoriteClick(event) {
        const button = event.target.closest('.favorite-btn'); if (!button) return;
        const type = button.getAttribute('data-type'); const id = button.getAttribute('data-id');
        console.log("[Event] Add favorite button clicked:", { type, id });
        if (type && id) addFavorite(type, id, button);
    }

    function handleRemoveFavoriteClick(event) {
        const button = event.target.closest('.favorite-btn'); if (!button) return;
        const type = button.getAttribute('data-type'); const id = button.getAttribute('data-id');
        const isInFavoritesList = button.closest('#favoritesList') !== null;
        console.log("[Event] Remove favorite button clicked:", { type, id, isInFavoritesList });
        if (type && id) removeFavorite(type, id, button, isInFavoritesList);
    }

    function handleViewOriginalSearchClick(event) {
        console.log("[Event] 'View Original Search' button clicked.");
        const button = event.target.closest('.view-original-search-btn'); if (!button) { console.log("[Event] Could not find button element."); return; }
        const query = button.getAttribute('data-query');
        console.log(`[Event] Extracted query: "${query}"`);
        if (!query) { alert("无法查看原始搜索，未找到相关查询词。"); console.log("[Event] Query is missing."); return; }
        const searchTabButton = document.querySelector('.tab-button[data-tab="searchTab"]');
        if (searchTabButton) { console.log("[Event] Switching to Search tab..."); searchTabButton.click(); }
        else { console.error("[Event] Search tab button not found."); return; }
        if (keywordSearch) { console.log(`[Event] Populating search input with: "${query}"`); keywordSearch.value = query; }
        else { console.error("[Event] Search input element not found."); return; }
        console.log("[Event] Scheduling search trigger...");
        setTimeout(() => { console.log("[Event] Triggering search now."); startSearch(); if(searchResultsContainer) searchResultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
    }

    function updateFavoriteButton(button, isFavorite) {
         if (!button) return;
         console.log(`[Render] Updating button for id=${button.getAttribute('data-id')} to isFavorite=${isFavorite}`);
         button.classList.toggle('favorited', isFavorite); // Use 'favorited' class from CSS
         const icon = button.querySelector('i');
         if (icon) {
             icon.classList.toggle('fas', isFavorite); // Solid star
             icon.classList.toggle('far', !isFavorite); // Regular star
         }
         button.innerHTML = `<i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}`;
         button.title = isFavorite ? '取消收藏' : '收藏';

         // Re-attach listeners after changing innerHTML
         const newButton = button.cloneNode(true);
         button.parentNode.replaceChild(newButton, button);
         if (isFavorite) { newButton.addEventListener('click', handleRemoveFavoriteClick); }
         else { newButton.addEventListener('click', handleAddFavoriteClick); }
     }

    function renderResultItem(metadata, isInFavoritesList = false) {
        if (!metadata) { console.warn("[Render] Received null or undefined metadata."); return ''; }
        const type = metadata.favorite_type || metadata.type; // Use favorite_type if available (from favorites API)
        if (!type) { console.warn("[Render] Item missing type:", metadata); return ''; }

        const id = metadata.id || metadata.group_id || metadata.wechat_id;
        if (!id) { console.warn("[Render] Item missing ID:", metadata); }

        const isFavorite = isInFavoritesList || metadata.is_favorite || false;
        const originalQuery = metadata.original_query || '';

        let content = '', headerInfo = '', footerContentHtml = '', contextHtml = '';

        try {
            switch (type) {
                case 'message':
                    headerInfo = `<div class="result-title">${escapeHtml(metadata.sender) || '未知发送者'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 聊天消息</span> <span><i class="far fa-clock"></i> ${formatTime(metadata.time)}</span></div>`;
                    let messageContent = isInFavoritesList ? escapeHtml(metadata.content) : (metadata.highlighted_content || escapeHtml(metadata.content));
                    content = `<div class="result-content">${messageContent || ''}</div>`;
                    contextHtml = `<div class="conversation-context-placeholder" data-message-id="${id}"></div>`; // Placeholder for context
                    footerContentHtml = `<div>来源: ${escapeHtml(metadata.source || metadata.source_file || '未知')}</div><div>`; // Wrap buttons
                    if (!isInFavoritesList) { // Only show context button in search results
                         footerContentHtml += `<button class="btn btn-secondary btn-sm show-context-btn" data-message-id="${id}"><i class="fas fa-comment-dots"></i> 上下文</button>`;
                    }
                    if (isInFavoritesList && originalQuery) {
                         footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`; // Close button wrapper
                    break;
                case 'contact':
                    headerInfo = `<div class="result-title">${isInFavoritesList ? escapeHtml(metadata.name) : (metadata.highlighted_name || escapeHtml(metadata.name)) || '未知联系人'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 通讯录联系人</span></div>`;
                    let phoneContent = isInFavoritesList ? escapeHtml(metadata.phone) : (metadata.highlighted_phone || escapeHtml(metadata.phone));
                    content = `<div class="result-content"><p><i class="fas fa-phone"></i> 电话: ${phoneContent || '无'}</p></div>`;
                    footerContentHtml = `<div></div><div>`; // Align button right
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`;
                    break;
                case 'wechat_group':
                    headerInfo = `<div class="result-title">${isInFavoritesList ? escapeHtml(metadata.group_name) : (metadata.highlighted_group_name || escapeHtml(metadata.group_name)) || '未知群组'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 微信群组</span>`;
                    if (metadata.member_count) headerInfo += ` <span><i class="fas fa-users"></i> ${metadata.member_count}人</span>`;
                    headerInfo += `</div>`;
                    content = `<div class="result-content">`;
                    let announcementContent = isInFavoritesList ? escapeHtml(metadata.announcement) : (metadata.highlighted_announcement || escapeHtml(metadata.announcement));
                    if (announcementContent) content += `<p><i class="fas fa-bullhorn"></i> 公告: ${announcementContent}</p>`;
                    content += `</div>`;
                    footerContentHtml = `<div></div><div>`;
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`;
                    break;
                 case 'wechat_contact':
                    let contactName = isInFavoritesList ? (escapeHtml(metadata.nickname) || escapeHtml(metadata.remark)) : (metadata.highlighted_nickname || metadata.highlighted_remark || escapeHtml(metadata.nickname) || escapeHtml(metadata.remark));
                    headerInfo = `<div class="result-title">${contactName || '未知用户'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 微信联系人</span></div>`;
                    content = `<div class="result-content">`;
                    let wcRemarkContent = isInFavoritesList ? escapeHtml(metadata.remark) : (metadata.highlighted_remark || escapeHtml(metadata.remark));
                    if (wcRemarkContent) content += `<p><i class="fas fa-user-edit"></i> 备注: ${wcRemarkContent}</p>`;
                    let wcPhoneContent = isInFavoritesList ? escapeHtml(metadata.phone) : (metadata.highlighted_phone || escapeHtml(metadata.phone));
                    if (wcPhoneContent) content += `<p><i class="fas fa-phone"></i> 电话: ${wcPhoneContent}</p>`;
                    content += `</div>`;
                    footerContentHtml = `<div></div><div>`;
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`;
                    break;
                default:
                    headerInfo = `<div class="result-title">未知类型: ${escapeHtml(type)}</div>`;
                    content = `<div class="result-content">${escapeHtml(JSON.stringify(metadata)).substring(0, 100)}...</div>`;
                    footerContentHtml = `<div></div><div>`; // Align right
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    // Add favorite button even for unknown types if ID exists
                    if (id) {
                         footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    }
                    footerContentHtml += `</div>`;
            }
        } catch (error) { console.error("[Render] Error rendering item:", error, metadata); content = `<div class="result-content error">渲染此项时出错</div>`; footerContentHtml = ''; contextHtml = '';}

        const footerHtml = `<div class="result-footer">${footerContentHtml}</div>`;

        return `<div class="result-item" data-item-id="${id}" data-item-type="${type}">
                    <div class="result-header">${headerInfo}</div>
                    ${content}
                    ${contextHtml}
                    ${footerHtml}
                </div>`;
    }

    function addInteractiveListeners(container, isInFavoritesList = false) {
        if (!container) { console.error("addInteractiveListeners called with null container."); return; }
        console.log(`[Listeners] Adding interactive listeners (isInFavoritesList=${isInFavoritesList}) for container:`, container.id);

        container.querySelectorAll('.favorite-btn').forEach(button => {
            const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
            if (newButton.classList.contains('favorited')) { newButton.addEventListener('click', handleRemoveFavoriteClick); }
            else { newButton.addEventListener('click', handleAddFavoriteClick); }
        });

        if (!isInFavoritesList) {
            container.querySelectorAll('.show-context-btn').forEach(button => {
                const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
                newButton.addEventListener('click', () => {
                    const messageId = newButton.getAttribute('data-message-id');
                    const resultItem = newButton.closest('.result-item');
                    const placeholder = resultItem ? resultItem.querySelector(`.conversation-context-placeholder[data-message-id="${messageId}"]`) : null;
                    if (!messageId || !placeholder || !resultItem) return;

                    const footerDiv = resultItem.querySelector('.result-footer'); // Find the footer

                    if (placeholder.innerHTML !== '') {
                         placeholder.innerHTML = '';
                         newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文';
                         if (footerDiv) footerDiv.style.borderTop = '1px solid var(--light-gray)'; // Restore border
                    } else {
                         newButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中'; newButton.disabled = true;
                         fetch(`/api/conversation-context?message_id=${messageId}&context_size=3&q=${encodeURIComponent(currentSearchQuery)}`)
                            .then(r => r.json()).then(d => {
                                if (d.context && d.context.length > 0) {
                                    showConversationContext(d.context, messageId, placeholder);
                                    newButton.innerHTML = '<i class="fas fa-comment-slash"></i> 隐藏上下文';
                                    if (footerDiv) footerDiv.style.borderTop = 'none'; // Hide border when context shown
                                } else {
                                    placeholder.innerHTML = '<p class="no-context">无上下文记录</p>';
                                    newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文';
                                }
                            }).catch(e => { console.error('获取上下文出错:', e); placeholder.innerHTML = `<p class="error">加载上下文失败</p>`; newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文'; })
                            .finally(() => { newButton.disabled = false; });
                    }
                });
            });
        }

        if (isInFavoritesList) {
             container.querySelectorAll('.view-original-search-btn').forEach(button => {
                 const query = button.getAttribute('data-query');
                 console.log(`[Listeners] Attaching 'View Search' listener. Query: "${query}"`, button);
                 const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
                 newButton.addEventListener('click', handleViewOriginalSearchClick);
             });
        }
    }

    function showConversationContext(contextMessages, currentMessageId, placeholderElement) {
        let contextHtml = '<div class="conversation-context">';
        contextMessages.forEach(msg => {
            const isCurrent = msg.id === currentMessageId;
            const messageClass = msg.is_sent ? 'context-message sent' : 'context-message received';
            const currentClass = isCurrent ? ' current-message' : '';
            contextHtml += `
                <div class="${messageClass}${currentClass}">
                    <div class="context-message-header">
                        <span class="context-message-sender">${escapeHtml(msg.sender) || '未知'}</span>
                        <span class="context-message-time">${formatTime(msg.time)}</span>
                    </div>
                    <div class="context-message-content">${msg.highlighted_content || escapeHtml(msg.content)}</div>
                </div>`;
        });
        contextHtml += '</div>';
        placeholderElement.innerHTML = contextHtml;
    }

    function renderPagination(currentPage, totalPages, container, callback) {
        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; }
        let paginationHtml = '';
        paginationHtml += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}"><i class="fas fa-chevron-left"></i></button>`;
        const maxPagesToShow = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
        if (endPage - startPage + 1 < maxPagesToShow) { startPage = Math.max(1, endPage - maxPagesToShow + 1); }
        if (startPage > 1) { paginationHtml += `<button class="pagination-btn" data-page="1">1</button>`; if (startPage > 2) paginationHtml += '<span class="pagination-ellipsis">...</span>'; }
        for (let i = startPage; i <= endPage; i++) { paginationHtml += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`; }
        if (endPage < totalPages) { if (endPage < totalPages - 1) paginationHtml += '<span class="pagination-ellipsis">...</span>'; paginationHtml += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`; }
        paginationHtml += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}"><i class="fas fa-chevron-right"></i></button>`;
        container.innerHTML = paginationHtml;
        container.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', function() { if (!this.disabled && this.dataset.page) { callback(parseInt(this.dataset.page)); } });
        });
    }

    function loadMessages(page = 1) {
         currentMessagesPage = page;
         if (!messagesListContainer || !messagesPaginationContainer) return;
         console.log(`[Messages] Loading messages page ${page}...`);
         showLoadingIndicator(messagesListContainer);
         messagesPaginationContainer.innerHTML = '';
         fetch(`/api/messages?page=${page}&page_size=50`)
            .then(r => r.json())
            .then(d => {
                console.log("[Messages] Messages data received:", d);
                if (!d.messages || d.messages.length === 0) { showNoResults(messagesListContainer, "没有聊天记录"); return; }
                let h = `<div class="results-summary">共 ${formatNumber(d.total)} 条记录 (第 ${d.page}/${d.total_pages} 页)</div><div class="results-list">`;
                d.messages.forEach(msg => { h += renderResultItem(msg, false); }); // Reuse renderResultItem
                h += `</div>`;
                messagesListContainer.innerHTML = h;
                renderPagination(d.page, d.total_pages, messagesPaginationContainer, loadMessages);
                addInteractiveListeners(messagesListContainer, false);
            })
            .catch(e => { showError(messagesListContainer, `加载聊天记录失败: ${e.message}`); console.error("[Messages] Load messages error:", e); });
    }

    function updateStats() {
        console.log("[Stats] Updating stats overview...");
        fetch('/api/stats')
            .then(response => response.json())
            .then(data => {
                console.log("[Stats] Stats data received:", data);
                const messageCountEl = document.getElementById('messageCount');
                const contactCountEl = document.getElementById('contactCount');
                const groupCountEl = document.getElementById('groupCount');
                const fileCountEl = document.getElementById('fileCount'); // Assuming this is success_files
                const lastUpdateEl = document.getElementById('lastUpdateTime');
                // --- Add Call Record Stat Element ---
                const callRecordCountEl = document.getElementById('callRecordCount'); // Need to add this ID to HTML

                if(messageCountEl) messageCountEl.textContent = formatNumber(data.messages_count || 0);
                if(contactCountEl) contactCountEl.textContent = formatNumber(data.contacts_count || 0);
                if(groupCountEl) groupCountEl.textContent = formatNumber(data.wechat_groups_count || 0);
                if(fileCountEl) fileCountEl.textContent = formatNumber(data.success_files || 0); // Assuming success_files is correct stat
                if(callRecordCountEl) callRecordCountEl.textContent = formatNumber(data.call_records_count || 0); // Update call records

                if(lastUpdateEl) {
                    const now = new Date();
                    const formattedDate = `${now.getFullYear()}-${padZero(now.getMonth() + 1)}-${padZero(now.getDate())} ${padZero(now.getHours())}:${padZero(now.getMinutes())}`;
                    lastUpdateEl.textContent = '最后更新: ' + formattedDate;
                }
            })
            .catch(error => console.error('[Stats] Error fetching stats:', error));
    }

    // --- Call Record Functions ---
    function setupCallRecordControls() {
         console.log("[CallRecords] Setting up controls...");
         if (updateCallChartBtn && callNumThresholdInput) {
              updateCallChartBtn.addEventListener('click', () => {
                  if (currentCallExcelId) {
                      const threshold = callNumThresholdInput.value;
                      fetchCallChartPreview(currentCallExcelId, threshold);
                  } else {
                      alert('请先加载通话记录数据。');
                  }
              });
         } else { console.warn("[CallRecords] Update chart button or threshold input not found."); }

         if (downloadCallExcelBtn) {
              downloadCallExcelBtn.addEventListener('click', () => {
                  if (currentCallExcelId) {
                      window.location.href = `/api/call-records/download?type=excel&id=${encodeURIComponent(currentCallExcelId)}`;
                  }
              });
         } else { console.warn("[CallRecords] Download Excel button not found."); }

         if (downloadCallChartBtn) {
              downloadCallChartBtn.addEventListener('click', () => {
                  if (currentCallChartId) {
                       window.location.href = `/api/call-records/download?type=chart&id=${encodeURIComponent(currentCallChartId)}`;
                  } else if (currentCallExcelId) {
                      alert("正在生成图表以下载...");
                      fetchCallChartPreview(currentCallExcelId, callNumThresholdInput?.value || 5);
                  } else {
                      alert('无图表可下载。');
                  }
              });
         } else { console.warn("[CallRecords] Download Chart button not found."); }
         console.log("[CallRecords] Controls setup complete.");
    }

    function loadCallRecordData(excelId) {
        console.log(`[CallRecords] Loading data for Excel ID: ${excelId}`);
        if (!excelId) { showCallError('错误：未提供有效的通话记录文件ID。'); return; }
        currentCallExcelId = excelId;
        showLoadingIndicator(callSummaryStatsEl, '加载统计...');
        showLoadingIndicator(callChartContainerEl, '加载图表...');
        showLoadingIndicator(callTopContactsListEl, '加载排行...');
        if(callChartImageEl) callChartImageEl.style.display = 'none';
        if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = true;
        if(downloadCallChartBtn) downloadCallChartBtn.disabled = true;

        fetch(`/api/call-records/all-call-records?excel_id=${encodeURIComponent(excelId)}`)
            .then(response => response.json())
            .then(data => {
                console.log("[CallRecords] Data received:", data);
                if (data.status === 'success') {
                    renderCallStats(data.stats);
                    fetchCallChartPreview(excelId, callNumThresholdInput?.value || 5); // Fetch initial chart
                    renderTopContacts(data.stats.top_contacts);
                    if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = false;
                } else { showCallError(`加载通话数据失败: ${data.message}`); }
            })
            .catch(error => { console.error('[CallRecords] Load data error:', error); showCallError(`加载通话数据出错: ${error.message}`); });
    }

    function fetchCallChartPreview(excelId, callNum) {
         console.log(`[CallRecords] Fetching chart preview for Excel ID: ${excelId}, Threshold: ${callNum}`);
         showLoadingIndicator(callChartContainerEl, '生成/加载图表...');
         if(callChartImageEl) callChartImageEl.style.display = 'none';
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = true;

         fetch('/api/call-records/update-chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excel_id: excelId, call_num: callNum }) })
         .then(response => response.json())
         .then(data => {
              console.log("[CallRecords] Chart update response:", data);
              if (data.status === 'success') {
                  renderCallChart(data.chart_data);
                  currentCallChartId = data.chart_id;
                  if(downloadCallChartBtn) downloadCallChartBtn.disabled = false;
              } else { showError(callChartContainerEl, `加载图表失败: ${data.message}`); }
         })
         .catch(error => { console.error('[CallRecords] Fetch chart error:', error); showError(callChartContainerEl, `加载图表出错: ${error.message}`); });
    }

    function renderCallStats(stats) {
        if (!callSummaryStatsEl) return;
        if (!stats) { callSummaryStatsEl.innerHTML = '<p>无统计数据</p>'; return; }
        callSummaryStatsEl.innerHTML = `
            <p><strong>总通话次数:</strong> ${formatNumber(stats.total_calls || 0)}</p>
            <p><strong>总通话时长:</strong> ${stats.total_duration || '0:00:00'}</p>
            <p><strong>已删除通话:</strong> ${formatNumber(stats.deleted_calls || 0)}</p>
            <p><strong>时间范围:</strong> ${stats.time_range?.start || 'N/A'} - ${stats.time_range?.end || 'N/A'}</p>
        `;
    }

    function renderCallChart(chartDataUrl) {
        if (!callChartContainerEl || !callChartImageEl) return;
        if (chartDataUrl) {
            callChartImageEl.src = chartDataUrl;
            callChartImageEl.style.display = 'block';
            callChartContainerEl.innerHTML = '';
            callChartContainerEl.appendChild(callChartImageEl);
        } else {
            showError(callChartContainerEl, '无法加载图表数据。');
            callChartImageEl.style.display = 'none';
        }
    }

    function renderTopContacts(contacts) {
        if (!callTopContactsListEl) return;
        if (!contacts || contacts.length === 0) { callTopContactsListEl.innerHTML = '<p>无常用联系人数据</p>'; return; }
        let listHtml = '<ul>';
        contacts.forEach(contact => {
            listHtml += `<li>${escapeHtml(contact.phone)} (${contact.call_count}次, ${contact.total_duration})</li>`;
        });
        listHtml += '</ul>';
        callTopContactsListEl.innerHTML = listHtml;
    }

    function showCallError(message) {
         if(callSummaryStatsEl) showError(callSummaryStatsEl, message);
         if(callChartContainerEl) callChartContainerEl.innerHTML = '';
         if(callTopContactsListEl) callTopContactsListEl.innerHTML = '';
         if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = true;
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = true;
    }

    function handleSuccessfulUpload(taskId, generatedExcelId, generatedChartId) {
         console.log("[Upload] Handling successful upload. Excel ID:", generatedExcelId, "Chart ID:", generatedChartId);
         if (generatedExcelId) {
             localStorage.setItem('lastCallExcelId', generatedExcelId);
             currentCallExcelId = generatedExcelId;
         }
         if (generatedChartId) {
             currentCallChartId = generatedChartId;
         }
         const activeTabButton = document.querySelector('.tab-button.active');
         if (activeTabButton && activeTabButton.getAttribute('data-tab') === 'callRecordsTab' && currentCallExcelId) {
             loadCallRecordData(currentCallExcelId);
         }
         if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = !currentCallExcelId;
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = !currentCallChartId && !currentCallExcelId; // Enable if chart exists or can be generated
    }

    // --- Utilities ---
    function escapeHtml(unsafe) { if (unsafe === null || unsafe === undefined) return ''; return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
    function formatTime(timeStr) { if (!timeStr || timeStr === 'None' || timeStr === 'NaT') return '未知时间'; try { let d=new Date(timeStr); if(isNaN(d.getTime())){ if(/^\d{10}$/.test(timeStr))d=new Date(parseInt(timeStr,10)*1000); else if(/^\d{13}$/.test(timeStr))d=new Date(parseInt(timeStr,10)); else if(isNaN(d.getTime()))return timeStr; } return d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); } catch(e){return timeStr;} }
    function formatNumber(num) { return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function padZero(num) { return num < 10 ? '0' + num : num; }
    function showLoadingIndicator(container, message = '加载中...') { if(container) container.innerHTML = `<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><p>${message}</p></div>`; }
    function showError(container, message) { if(container) container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle"></i><p>${message}</p></div>`; }
    function showNoResults(container, message) { if(container) container.innerHTML = `<div class="no-results-message"><i class="fas fa-search"></i><p>${message}</p></div>`; }

    // --- Initial Data Load ---
    updateStats();
    loadSearchHistory();
    // loadInitialFavorites(); // Consider loading favorites only when tab is clicked

}); // End of DOMContentLoaded
