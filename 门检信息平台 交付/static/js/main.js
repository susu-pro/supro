document.addEventListener('DOMContentLoaded', function() {
  
    let currentTaskId = null;
    let currentMessagesPage = 1;
    let currentSearchPage = 1;
    let currentSearchQuery = '';
    let currentFavoritesPage = 1;
    let taskCheckInterval = null;
    let currentCallExcelId = localStorage.getItem('lastCallExcelId'); 
    let currentCallChartId = null;

  
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const uploadForm = document.getElementById('uploadForm'); // 假设表单存在
    const fileInput = document.getElementById('fileInput'); // 假设输入框存在
    const uploadStatus = document.getElementById('uploadStatus');
    const searchButton = document.querySelector('#searchTab #searchButton');
    const keywordSearch = document.getElementById('keywordSearch');
    const searchResultsContainer = document.getElementById('searchResults');
    const searchHistoryContainer = document.getElementById('searchHistory'); 
    const searchPaginationContainer = document.getElementById('searchPagination'); 
    const favoritesListContainer = document.getElementById('favoritesList'); 
    const favoritesPaginationContainer = document.getElementById('favoritesPagination'); 
    const messagesListContainer = document.getElementById('messagesList'); 
    const messagesPaginationContainer = document.getElementById('messagesPagination');

    // 通话记录选项卡元素
    const callRecordsTab = document.getElementById('callRecordsTab');
    const callSummaryStatsEl = document.getElementById('callSummaryStats');
    const callChartContainerEl = document.getElementById('callChartContainer');
    const callChartImageEl = document.getElementById('callChartImage');
    const callTopContactsListEl = document.getElementById('callTopContactsList');
    const updateCallChartBtn = document.getElementById('updateCallChartBtn');
    const callNumThresholdInput = document.getElementById('callNumThreshold');
    const downloadCallExcelBtn = document.getElementById('downloadCallExcelBtn');
    const downloadCallChartBtn = document.getElementById('downloadCallChartBtn');



    try {
        setupTabs(); // 选项卡切换
        setupUploadControls(); // 文件上传控件
        setupSearchHistory(); // 搜索历史
        setupSearchControls(); // 搜索控件
        setupCallRecordControls(); // 通话记录控件
    } catch (error) {
        console.error("[Init] 初始化设置期间发生严重错误:", error);
        if(uploadStatus) uploadStatus.innerHTML = `<p class="error">页面初始化错误: ${error.message}.</p>`;
    }

    // 选项卡切换
    function setupTabs() {
        if (!tabButtons || tabButtons.length === 0) { console.warn("[Tabs] 未找到选项卡按钮。"); return; }
        tabButtons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);

            newButton.addEventListener('click', function() {
                // 移除所有按钮和内容的 active 类
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                // 添加 active 类到当前按钮和内容
                this.classList.add('active');
                const tabId = this.getAttribute('data-tab');
                const activeTabContent = document.getElementById(tabId);
                if (activeTabContent) {
                    activeTabContent.classList.add('active');
                    if (tabId === 'favoritesTab') loadFavorites(1);
                    if (tabId === 'messagesTab') loadMessages(1); // 点击时加载消息
                    if (tabId === 'searchTab') loadSearchHistory();
                    if (tabId === 'callRecordsTab') {
                        if (currentCallExcelId) {
                             loadCallRecordData(currentCallExcelId); // 加载通话记录数据
                        } else {
                             showCallError('请先上传包含通话记录的JSON文件并等待处理完成。'); // 显示错误信息
                        }
                    }
                } else { console.error(`[Tabs] 未找到选项卡内容 ID '${tabId}'。`); }
            });
        });
        // 激活初始选项卡（搜索或第一个）
        const initialTabButton = document.querySelector('.tab-button[data-tab="searchTab"]') || document.querySelector('.tab-button');
        if(initialTabButton) {
             const newInitialButton = Array.from(document.querySelectorAll('.tab-button')).find(btn => btn.getAttribute('data-tab') === initialTabButton.getAttribute('data-tab'));
             if (newInitialButton) newInitialButton.click();
             else initialTabButton.click();
        } else { console.warn("[Tabs] 未找到初始选项卡按钮。"); }
    }

    //  文件上传相关控件
    function setupUploadControls() {
        const uploadButton = document.getElementById('uploadButton'); 
        const clearButton = document.getElementById('clearButton'); 
        const dropArea = document.getElementById('dropArea'); // 来自 index.html

        // 绑定上传按钮点击事件
        if (uploadButton && fileInput) {
             uploadButton.addEventListener('click', handleUpload);
        } else { console.error("[Upload] 未找到上传按钮或文件输入框。"); }

        // 绑定清空按钮点击事件
        if (clearButton && fileInput) {
             clearButton.addEventListener('click', () => {
                 fileInput.value = ''; 
                 resetUploadArea();
                 if(processStatus) processStatus.classList.remove('active');
             });
        } else { console.error("[Upload] 未找到清空按钮或文件输入框。"); }

        // 拖放区域事件
        if (dropArea && fileInput) {
             ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                 dropArea.addEventListener(eventName, preventDefaults, false); 
             });
             ['dragenter', 'dragover'].forEach(eventName => {
                 dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false); // 高亮
             });
             ['dragleave', 'drop'].forEach(eventName => {
                 dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false); // 移除高亮
             });
             dropArea.addEventListener('drop', handleDrop, false); // 处理文件拖放
             fileInput.addEventListener('change', () => updateFileInfo(fileInput.files)); // 文件选择变化时更新信息
        } else { console.error("[Upload] 未找到拖放区域或文件输入框。"); }

    }

    // 阻止浏览器拖放行为
    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    // 处理文件拖放事件
    function handleDrop(e) {
        const files = e.dataTransfer.files;
        if (fileInput) fileInput.files = files; 
        updateFileInfo(files); // 更新文件信息显示
    }

    // 更新拖放区域的文件信息显示
    function updateFileInfo(files) {
        const dropArea = document.getElementById('dropArea');
        const uploadButton = document.getElementById('uploadButton');
        if (!dropArea || !uploadButton) return;

        if (files && files.length > 0) {
            const fileNames = Array.from(files).map(file => escapeHtml(file.name)).join(', ');
            dropArea.innerHTML = `<i class="fas fa-file-alt"></i><div class="drop-text">已选择 ${files.length} 个文件</div><div class="drop-hint">${fileNames}</div>`;
            uploadButton.disabled = false; // 启用上传按钮
        } else {
            resetUploadArea(); // 重置为初始状态
        }
    }

    // 重置拖放区域到初始状态
    function resetUploadArea() {
        const dropArea = document.getElementById('dropArea');
        const uploadButton = document.getElementById('uploadButton');
        if (!dropArea || !uploadButton) return;
        dropArea.innerHTML = `<i class="fas fa-file-upload"></i><div class="drop-text">点击选择或拖放文件到此处</div><div class="drop-hint">支持 JSON 格式文件，最大上传大小: 20GB</div>`;
        uploadButton.disabled = true; // 禁用上传按钮
    }

    // 处理文件上传逻辑
    function handleUpload() {
        if (!fileInput) { console.error("[Upload] 未找到文件输入框进行上传。"); return; }
        const files = fileInput.files;
        if (!files || files.length === 0) { if(uploadStatus) uploadStatus.innerHTML = '<p class="error">请选择文件。</p>'; return; }

        // 文件格式
        const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length !== files.length) { if(uploadStatus) uploadStatus.innerHTML = '<p class="error">请确保所有文件都是 .json 格式。</p>'; return; }

        //  FormData 并添加文件
        const formData = new FormData();
        jsonFiles.forEach(file => formData.append('files[]', file));

        // 显示上传进度
        if(processStatus) processStatus.classList.add('active');
        const progressBar = document.getElementById('progressBar');
        const progressPercent = document.getElementById('progressPercent');
        const statusText = document.getElementById('statusText');
        if(progressBar) progressBar.style.width = '0%';
        if(progressPercent) progressPercent.textContent = '0%';
        if(statusText) statusText.textContent = '正在上传文件...';
        const uploadButton = document.getElementById('uploadButton');
        if(uploadButton) uploadButton.disabled = true; // 禁用上传按钮

        // 清除之前的任务检查定时器
        if (taskCheckInterval) { clearInterval(taskCheckInterval); taskCheckInterval = null; }

        fetch('/api/start-processing', { method: 'POST', body: formData })
            .then(response => {
                 if (!response.ok) { return response.json().catch(() => null).then(errData => { throw new Error(`上传失败 (${response.status}): ${errData?.message || response.statusText}`); }); }
                 return response.json();
            })
            .then(data => {
                if (data.status === 'started' && data.task_id) {
                    currentTaskId = data.task_id;
                    checkTaskStatus(currentTaskId); // 立即检查一次
                    taskCheckInterval = setInterval(() => checkTaskStatus(currentTaskId), 2000); // 定时检查
                } else {
                    const errorMsg = data.message || '启动处理失败。';
                    console.error(`[Upload] API 返回非 started 状态: ${data.status} - ${errorMsg}`);
                    if(statusText) statusText.textContent = `错误: ${errorMsg}`;
                    if(uploadButton) uploadButton.disabled = false; // 重新启用上传按钮
                    if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; // 清除定时器
                }
            })
            .catch(error => {
                 console.error("[Upload] Fetch 请求失败:", error);
                 if(statusText) statusText.textContent = `上传请求失败: ${error.message}`;
                 if(uploadButton) uploadButton.disabled = false; // 重新启用上传按钮
                 if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; // 清除定时器
            });
    }

    // 检查后台任务状态
    function checkTaskStatus(taskId) {
        if (!taskId) { if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; return; }
        fetch(`/api/task-status/${taskId}`)
            .then(response => {
                 if (!response.ok) {
                     if (response.status === 404) { console.error(`[StatusCheck] 任务 ${taskId} 未找到 (404)。停止轮询。`); if(uploadStatus) uploadStatus.innerHTML = `<p class="error">任务 ${taskId} 未找到。</p>`; if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; }
                     throw new Error(`HTTP 错误！状态: ${response.status}`);
                 }
                 return response.json();
             })
            .then(data => {=
                // 获取进度条和状态显示元素
                const progressBar = document.getElementById('progressBar');
                const progressPercent = document.getElementById('progressPercent');
                const statusText = document.getElementById('statusText');
                const processedFilesEl = document.getElementById('processedFiles');
                const successFilesEl = document.getElementById('successFiles');
                const failedFilesEl = document.getElementById('failedFiles');
                const uploadButton = document.getElementById('uploadButton');

                // 处理任务错误状态
                if (data.status === 'error') { console.error(`[StatusCheck] 任务 ${taskId} 失败: ${data.error}`, data.batch_errors); let errorMsg = `<p class="error">处理失败: ${data.error || '未知错误'}</p>`; if (data.batch_errors?.length > 0) { errorMsg += '<ul class="error">'; data.batch_errors.forEach(err => errorMsg += `<li>${escapeHtml(err)}</li>`); errorMsg += '</ul>'; } if(statusText) statusText.innerHTML = errorMsg; if(uploadButton) uploadButton.disabled = false; if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; return; }

                // 处理任务完成状态
                if (data.status === 'completed') {
                    if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; // 清除定时器
                    // 更新状态显示为完成
                    if(statusText) { let message = `<p class="success">处理完成!</p>`; statusText.innerHTML = message; }
                    if(progressBar) progressBar.style.width = '100%';
                    if(progressPercent) progressPercent.textContent = '100%';
                    if(processedFilesEl) processedFilesEl.textContent = data.total_files || 0;
                    if(successFilesEl) successFilesEl.textContent = data.success_files || 0;
                    if(failedFilesEl) failedFilesEl.textContent = data.failed_files || 0;
                    if(uploadButton) uploadButton.disabled = false; // 启用上传按钮
                    updateStats(); // 更新概览统计

                    // --- 通话记录处理 ---
                    const generatedExcelId = data.result_files?.excel; 
                    if (generatedExcelId) {
                        handleSuccessfulUpload(taskId, generatedExcelId, data.result_files?.chart); 
                    } else {
                        console.warn("[StatusCheck] 任务完成，但响应中未找到通话记录的 Excel ID。");
                    }
                    // --- 结束通话记录处理 ---

                    return;
                }

                // 更新进度条和状态文本
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

                // 如果状态不是进行中，停止轮询
                if (!['processing', 'queued', 'processing_batch'].includes(data.status)) { console.warn(`[StatusCheck] 意外的任务状态 '${data.status}'。停止轮询。`); if (taskCheckInterval) clearInterval(taskCheckInterval); taskCheckInterval = null; }
            })
            .catch(error => { console.error(`[StatusCheck] 获取任务 ${taskId} 状态时出错:`, error); });
    }

    // 设置搜索历史相关功能
    function setupSearchHistory() {
        loadSearchHistory(); // 加载现有历史
        if (searchHistoryContainer) {
            // 使用事件委托处理历史记录项点击和清空按钮点击
            searchHistoryContainer.addEventListener('click', function(e) {
                if (e.target.classList.contains('history-item')) { // 点击历史记录项
                    const query = e.target.getAttribute('data-query');
                    if (keywordSearch) { keywordSearch.value = query; } // 填充搜索框
                    startSearch(); // 开始搜索
                } else if (e.target.id === 'clearHistoryBtn' || e.target.closest('#clearHistoryBtn')) { // 点击清空按钮
                    clearSearchHistory();
                }
            });
        }
    }

    // 从 API 加载搜索历史
    function loadSearchHistory() {
        if (!searchHistoryContainer) return;
        fetch('/api/search-history')
            .then(response => response.json())
            .then(data => {
                const historyItems = data.search_history || [];
                if (historyItems.length === 0) {
                    searchHistoryContainer.style.display = 'none'; return; // 没有历史则隐藏
                }
                searchHistoryContainer.style.display = 'block'; // 有历史则显示
                // 构建历史记录列表的 HTML
                let historyHTML = `<div class="search-history-header"><div class="search-history-title"><i class="fas fa-history"></i> 搜索历史</div><button class="clear-history-btn" id="clearHistoryBtn"><i class="fas fa-trash-alt"></i> 清空</button></div><div class="search-history-items">`;
                historyItems.slice(0, 10).forEach(item => { // 最多显示 10 条
                    historyHTML += `<div class="history-item" data-query="${escapeHtml(item)}"><i class="fas fa-search"></i> ${escapeHtml(item)}</div>`;
                });
                historyHTML += '</div>';
                searchHistoryContainer.innerHTML = historyHTML;
            })
            .catch(error => { console.error("[History] 加载搜索历史错误:", error); searchHistoryContainer.style.display = 'none'; });
    }

    // 清空搜索历史
    function clearSearchHistory() {
        if(!confirm("确定要清空所有搜索历史吗？")) return; // 确认操作
        fetch('/api/search-history/clear', {method:'POST'})
            .then(r => r.json())
            .then(d => { if(d.status === 'success') { loadSearchHistory(); } else { alert('清空搜索历史失败: '+(d.message||'未知错误')); console.error("[History] 清空历史 API 错误:", d.message); } })
            .catch(e => { alert('清空搜索历史请求失败'); console.error("[History] 清空历史 fetch 错误:", e); });
    }

    // 设置搜索控件事件
    function setupSearchControls() {
        if (searchButton) { searchButton.addEventListener('click', startSearch); } // 搜索按钮点击
        if (keywordSearch) {
            keywordSearch.addEventListener('keypress', function(e){ if(e.key === 'Enter') startSearch(); }); // 回车搜索
            keywordSearch.addEventListener('focus', loadSearchHistorySuggestions); // 输入框聚焦时加载历史建议
        }
        const historySuggestionsContainer = document.getElementById('searchHistorySuggestions'); // 这是现在的历史列表本身
        if (historySuggestionsContainer) {
            // 事件委托在 setupSearchHistory 中处理
            document.addEventListener('click', function(e){
                if (keywordSearch && historySuggestionsContainer && !keywordSearch.contains(e.target) && !historySuggestionsContainer.contains(e.target)) {
                     // 如果建议下拉框存在，在此处隐藏它
                }
            });
        }
    }

     // 加载搜索历史作为建议项
     function loadSearchHistorySuggestions() {
         const container = document.getElementById('searchSuggestions'); 
         if (!container) return;
         fetch('/api/search-history')
             .then(r => r.json())
             .then(d => {
                 if(d.search_history?.length > 0) {
                     // 构建建议项 HTML
                     container.innerHTML = d.search_history.slice(0, 5).map(i => `<div class="suggestion-item" data-query="${escapeHtml(i)}">${escapeHtml(i)}</div>`).join('');
                     container.classList.add('show'); 
                     container.querySelectorAll('.suggestion-item').forEach(item => {
                         item.addEventListener('click', function() {
                             if (keywordSearch) keywordSearch.value = this.getAttribute('data-query'); // 填充输入框
                             container.classList.remove('show'); // 隐藏建议
                             startSearch(); // 开始搜索
                         });
                     });
                 } else {
                     container.classList.remove('show'); // 无建议则隐藏
                 }
             })
             .catch(e => { console.error("[Search] 建议加载错误", e); if(container) container.classList.remove('show'); });
     }

    // 开始搜索
    function startSearch() {
        currentSearchPage = 1; // 重置页码
        currentSearchQuery = keywordSearch ? keywordSearch.value.trim() : ''; // 获取查询词
        const searchTypeSelect = document.getElementById('searchTypeSelect');
        const currentSearchType = searchTypeSelect ? searchTypeSelect.value : 'combined'; /
        if (!currentSearchQuery) { if (searchResultsContainer) searchResultsContainer.innerHTML = '<p>请输入搜索关键词。</p>'; return; } // 空查询处理
        if (searchResultsContainer) showLoadingIndicator(searchResultsContainer, '搜索中...'); 
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if(suggestionsContainer) suggestionsContainer.classList.remove('show'); // 隐藏建议
        performSearch(currentSearchQuery, currentSearchType, currentSearchPage);
    }

    // 执行搜索 API 调用
    function performSearch(query, type, page) {
        if (!searchResultsContainer) return;
        const apiUrl = `/api/search?q=${encodeURIComponent(query)}&page=${page}&page_size=20&type=${type}&context_size=3`; // 构建 API URL
        fetch(apiUrl)
            .then(response => { if (!response.ok) throw new Error(`HTTP 错误！状态: ${response.status}`); return response.json(); })
            .then(data => { displaySearchResults(data); }) // 显示结果
            .catch(error => { showError(searchResultsContainer, `搜索出错: ${error.message}`); console.error('[Search] 搜索错误:', error); }); // 显示错误
    }

    // 显示搜索结果
    function displaySearchResults(data) {
        if (!searchResultsContainer) return;
        const results = data.results || [];
        // 如果第一页无结果，显示提示信息
        if (results.length === 0 && data.page === 1) { showNoResults(searchResultsContainer, `没有找到与 "<strong>${escapeHtml(data.query)}</strong>" 相关的结果。`); return; }

        let resultsHTML = '';
        // 第一页显示结果摘要
        if (data.page === 1) { const typeMap={'combined':'混合','keyword':'关键词','semantic':'语义','sender':'发送者'}; resultsHTML += `<div class="results-summary">找到 ${formatNumber(data.total||0)} 个结果 (搜索类型: ${typeMap[data.search_type]||data.search_type})</div>`; }
        resultsHTML += '<div class="results-list">';
        // 渲染每个结果项
        results.forEach(result => { if (!result || !result.data) { console.warn("[Search] 无效的搜索结果:", result); return; } resultsHTML += renderResultItem(result.data, false); });
        resultsHTML += '</div>';

        searchResultsContainer.innerHTML = resultsHTML; // 更新结果容器
        // 渲染分页控件
        renderPagination(data.page, data.total_pages, searchPaginationContainer, (newPage) => { currentSearchPage = newPage; performSearch(currentSearchQuery, document.getElementById('searchTypeSelect')?.value || 'combined', newPage); });
        // 为结果项添加交互监听器
        addInteractiveListeners(searchResultsContainer, false);
    }

    // 加载收藏夹内容
    function loadFavorites(page) {
        currentFavoritesPage = page;
        if (!favoritesListContainer || !favoritesPaginationContainer) return;
        showLoadingIndicator(favoritesListContainer); // 显示加载指示器
        favoritesPaginationContainer.innerHTML = ''; // 清空旧分页
        fetch(`/api/favorites?page=${page}&page_size=10`) // 收藏夹每页显示 10 条
            .then(r => r.json())
            .then(d => {
                if (!d.results || d.results.length === 0) { showNoResults(favoritesListContainer, "收藏夹是空的"); return; } // 空收藏夹处理
                // 构建收藏夹列表 HTML
                let h = `<div class="results-summary">共 ${formatNumber(d.total)} 个收藏项 (第 ${d.page}/${d.total_pages} 页)</div><div class="results-list">`;
                d.results.forEach(r => { if (!r || !r.data) { console.warn("[Favorites] 无效的收藏项:", r); return; } h += renderResultItem(r.data, true); });
                h += '</div>';
                favoritesListContainer.innerHTML = h; 
                renderPagination(d.page, d.total_pages, favoritesPaginationContainer, loadFavorites); 
                addInteractiveListeners(favoritesListContainer, true); 
            })
            .catch(e => { showError(favoritesListContainer, `加载收藏夹失败: ${e.message}`); console.error("[Favorites] 加载收藏夹错误:", e); }); // 显示错误
    }

    // 添加收藏
    function addFavorite(type, id, buttonElement) {
         fetch('/api/favorites/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id, query: currentSearchQuery }) })
         .then(r=>r.json()).then(d=>{ if (d.status==='success'||d.status==='info') { if (buttonElement) updateFavoriteButton(buttonElement, true); const favTab=document.querySelector('.tab-button[data-tab="favoritesTab"]'); if(favTab?.classList.contains('active')) loadFavorites(currentFavoritesPage); } else { alert('添加收藏失败: '+(d.message||'未知错误')); } }).catch(e=>{ alert('添加收藏请求失败'); console.error("[Favorites] 添加收藏错误:", e); });
    }

    // 移除收藏
    function removeFavorite(type, id, buttonElement, isInFavoritesList = false) {
         fetch('/api/favorites/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id }) })
         .then(r=>r.json()).then(d=>{ if (d.status==='success') { if(isInFavoritesList){ const itemEl=buttonElement.closest('.result-item'); if(itemEl){ itemEl.remove(); /*console.log("[Favorites] 已从收藏列表显示中移除项。");*/ if(favoritesListContainer&&favoritesListContainer.querySelectorAll('.result-item').length===0) loadFavorites(currentFavoritesPage); } } else { if(buttonElement) updateFavoriteButton(buttonElement, false); } } else { alert('移除收藏失败: '+(d.message||'未知错误')); } }).catch(e=>{ alert('移除收藏请求失败'); console.error("[Favorites] 移除收藏错误:", e); });
    }

    // 处理添加收藏按钮点击事件
    function handleAddFavoriteClick(event) {
        const button = event.target.closest('.favorite-btn'); if (!button) return;
        const type = button.getAttribute('data-type'); const id = button.getAttribute('data-id');
        if (type && id) addFavorite(type, id, button);
    }

    // 处理移除收藏按钮点击事件
    function handleRemoveFavoriteClick(event) {
        const button = event.target.closest('.favorite-btn'); if (!button) return;
        const type = button.getAttribute('data-type'); const id = button.getAttribute('data-id');
        const isInFavoritesList = button.closest('#favoritesList') !== null; 
        if (type && id) removeFavorite(type, id, button, isInFavoritesList);
    }

    // 处理“查看原始搜索”按钮点击事件
    function handleViewOriginalSearchClick(event) {
        const button = event.target.closest('.view-original-search-btn'); if (!button) { return; }
        const query = button.getAttribute('data-query');
        if (!query) { alert("无法查看原始搜索，未找到相关查询词。"); return; }
        // 切换到搜索选项卡
        const searchTabButton = document.querySelector('.tab-button[data-tab="searchTab"]');
        if (searchTabButton) { searchTabButton.click(); }
        else { console.error("[Event] 未找到搜索选项卡按钮。"); return; }
        // 填充搜索框
        if (keywordSearch) { keywordSearch.value = query; }
        else { console.error("[Event] 未找到搜索输入框元素。"); return; }
        // 延迟触发搜索，确保选项卡切换和输入框填充完成
        setTimeout(() => {startSearch(); if(searchResultsContainer) searchResultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
    }

    // 更新收藏按钮的状态和样式
    function updateFavoriteButton(button, isFavorite) {
         if (!button) return;
         button.classList.toggle('favorited', isFavorite); // 使用 CSS 中的 'favorited' 类
         const icon = button.querySelector('i');
         if (icon) {
             icon.classList.toggle('fas', isFavorite); // 实心星标
             icon.classList.toggle('far', !isFavorite); // 空心星标
         }
         button.innerHTML = `<i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}`;
         button.title = isFavorite ? '取消收藏' : '收藏';

         // 更改 innerHTML 后重新附加监听器
         const newButton = button.cloneNode(true);
         button.parentNode.replaceChild(newButton, button);
         if (isFavorite) { newButton.addEventListener('click', handleRemoveFavoriteClick); }
         else { newButton.addEventListener('click', handleAddFavoriteClick); }
     }

    // 渲染单个结果项（搜索结果或收藏项）
    function renderResultItem(metadata, isInFavoritesList = false) {
        if (!metadata) { console.warn("[Render] 收到 null 或 undefined 的元数据。"); return ''; }
        const type = metadata.favorite_type || metadata.type; 
        if (!type) { console.warn("[Render] 项目缺少类型:", metadata); return ''; }

        const id = metadata.id || metadata.group_id || metadata.wechat_id; // 获取 ID
        if (!id) { console.warn("[Render] 项目缺少 ID:", metadata); }

        const isFavorite = isInFavoritesList || metadata.is_favorite || false; // 判断是否已收藏
        const originalQuery = metadata.original_query || ''; 

        let content = '', headerInfo = '', footerContentHtml = '', contextHtml = '';

        try {
            // 根据不同类型渲染内容
            switch (type) {
                case 'message': // 聊天消息
                    headerInfo = `<div class="result-title">${escapeHtml(metadata.sender) || '未知发送者'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 聊天消息</span> <span><i class="far fa-clock"></i> ${formatTime(metadata.time)}</span></div>`;
                    let messageContent = isInFavoritesList ? escapeHtml(metadata.content) : (metadata.highlighted_content || escapeHtml(metadata.content));
                    content = `<div class="result-content">${messageContent || ''}</div>`;
                    contextHtml = `<div class="conversation-context-placeholder" data-message-id="${id}"></div>`; // 上下文占位符
                    footerContentHtml = `<div>来源: ${escapeHtml(metadata.source || metadata.source_file || '未知')}</div><div>`; // 按钮包装器
                    if (!isInFavoritesList) { // 仅在搜索结果中显示上下文按钮
                         footerContentHtml += `<button class="btn btn-secondary btn-sm show-context-btn" data-message-id="${id}"><i class="fas fa-comment-dots"></i> 上下文</button>`;
                    }
                    if (isInFavoritesList && originalQuery) { // 在收藏夹中显示“查看搜索”按钮
                         footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`; // 关闭按钮包装器
                    break;
                case 'contact': // 通讯录联系人
                    headerInfo = `<div class="result-title">${isInFavoritesList ? escapeHtml(metadata.name) : (metadata.highlighted_name || escapeHtml(metadata.name)) || '未知联系人'}</div><div class="result-meta"><span><i class="fas fa-tag"></i> 通讯录联系人</span></div>`;
                    let phoneContent = isInFavoritesList ? escapeHtml(metadata.phone) : (metadata.highlighted_phone || escapeHtml(metadata.phone));
                    content = `<div class="result-content"><p><i class="fas fa-phone"></i> 电话: ${phoneContent || '无'}</p></div>`;
                    footerContentHtml = `<div></div><div>`; // 使按钮右对齐
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    footerContentHtml += `</div>`;
                    break;
                case 'wechat_group': // 微信群组
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
                 case 'wechat_contact': // 微信联系人
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
                default: // 未知类型
                    headerInfo = `<div class="result-title">未知类型: ${escapeHtml(type)}</div>`;
                    content = `<div class="result-content">${escapeHtml(JSON.stringify(metadata)).substring(0, 100)}...</div>`;
                    footerContentHtml = `<div></div><div>`; // 使按钮右对齐
                    if (isInFavoritesList && originalQuery) {
                        footerContentHtml += ` <button class="btn btn-secondary btn-sm view-original-search-btn" data-query="${escapeHtml(originalQuery)}" data-type="${type}" data-id="${id}" title="查看原始搜索: ${escapeHtml(originalQuery)}"><i class="fas fa-search"></i> 查看搜索</button>`;
                    }
                    // 如果存在 ID，即使类型未知也添加收藏按钮
                    if (id) {
                         footerContentHtml += ` <button class="btn btn-secondary btn-sm favorite-btn ${isFavorite ? 'favorited' : ''}" data-type="${type}" data-id="${id}" data-query="${escapeHtml(currentSearchQuery)}"><i class="${isFavorite ? 'fas' : 'far'} fa-star"></i> ${isFavorite ? '已收藏' : '收藏'}</button>`;
                    }
                    footerContentHtml += `</div>`;
            }
        } catch (error) { console.error("[Render] 渲染项时出错:", error, metadata); content = `<div class="result-content error">渲染此项时出错</div>`; footerContentHtml = ''; contextHtml = '';}

        const footerHtml = `<div class="result-footer">${footerContentHtml}</div>`;

        // 组装最终的 HTML 结构
        return `<div class="result-item" data-item-id="${id}" data-item-type="${type}">
                    <div class="result-header">${headerInfo}</div>
                    ${content}
                    ${contextHtml}
                    ${footerHtml}
                </div>`;
    }


    function addInteractiveListeners(container, isInFavoritesList = false) {
        if (!container) { console.error("调用 addInteractiveListeners 时容器为 null。"); return; }
        container.querySelectorAll('.favorite-btn').forEach(button => {
            // 重新绑定事件，避免重复监听
            const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
            if (newButton.classList.contains('favorited')) { newButton.addEventListener('click', handleRemoveFavoriteClick); } // 已收藏则绑定移除事件
            else { newButton.addEventListener('click', handleAddFavoriteClick); } // 未收藏则绑定添加事件
        });

        // 处理“显示上下文”按钮（仅在非收藏夹列表）
        if (!isInFavoritesList) {
            container.querySelectorAll('.show-context-btn').forEach(button => {
                const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
                newButton.addEventListener('click', () => {
                    const messageId = newButton.getAttribute('data-message-id');
                    const resultItem = newButton.closest('.result-item');
                    const placeholder = resultItem ? resultItem.querySelector(`.conversation-context-placeholder[data-message-id="${messageId}"]`) : null;
                    if (!messageId || !placeholder || !resultItem) return;

                    const footerDiv = resultItem.querySelector('.result-footer'); // 找到页脚

                    // 如果上下文已显示，则隐藏
                    if (placeholder.innerHTML !== '') {
                         placeholder.innerHTML = ''; 
                         newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文'; 
                         if (footerDiv) footerDiv.style.borderTop = '1px solid var(--light-gray)'; 
                    } else { 
                         newButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中'; newButton.disabled = true; // 显示加载状态
                         fetch(`/api/conversation-context?message_id=${messageId}&context_size=3&q=${encodeURIComponent(currentSearchQuery)}`)
                            .then(r => r.json()).then(d => {
                                if (d.context && d.context.length > 0) {
                                    showConversationContext(d.context, messageId, placeholder); // 显示上下文
                                    newButton.innerHTML = '<i class="fas fa-comment-slash"></i> 隐藏上下文';
                                    if (footerDiv) footerDiv.style.borderTop = 'none'; // 显示上下文时隐藏边框
                                } else {
                                    placeholder.innerHTML = '<p class="no-context">无上下文记录</p>'; // 无上下文提示
                                    newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文';
                                }
                            }).catch(e => { console.error('获取上下文出错:', e); placeholder.innerHTML = `<p class="error">加载上下文失败</p>`; newButton.innerHTML = '<i class="fas fa-comment-dots"></i> 上下文'; }) // 错误处理
                            .finally(() => { newButton.disabled = false; }); 
                    }
                });
            });
        }

        // 处理“查看原始搜索”按钮（仅在收藏夹列表）
        if (isInFavoritesList) {
             container.querySelectorAll('.view-original-search-btn').forEach(button => {
                 const query = button.getAttribute('data-query');
                 const newButton = button.cloneNode(true); button.parentNode.replaceChild(newButton, button);
                 newButton.addEventListener('click', handleViewOriginalSearchClick); 
             });
        }
    }

    // 显示聊天消息的上下文
    function showConversationContext(contextMessages, currentMessageId, placeholderElement) {
        let contextHtml = '<div class="conversation-context">'; // 上下文容器
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

    // 渲染分页控件
    function renderPagination(currentPage, totalPages, container, callback) {
        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; } // 总页数小于等于 1 时不显示分页

        let paginationHtml = '';
        // 上一页按钮
        paginationHtml += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}"><i class="fas fa-chevron-left"></i></button>`;

        // 计算显示的页码范围
        const maxPagesToShow = 5; // 最多显示 5 个页码按钮
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
        if (endPage - startPage + 1 < maxPagesToShow) { startPage = Math.max(1, endPage - maxPagesToShow + 1); } // 调整起始页码

        // 显示第一页和省略号
        if (startPage > 1) { paginationHtml += `<button class="pagination-btn" data-page="1">1</button>`; if (startPage > 2) paginationHtml += '<span class="pagination-ellipsis">...</span>'; }

        // 显示中间页码
        for (let i = startPage; i <= endPage; i++) { paginationHtml += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`; }

        // 显示省略号和最后一页
        if (endPage < totalPages) { if (endPage < totalPages - 1) paginationHtml += '<span class="pagination-ellipsis">...</span>'; paginationHtml += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`; }

        // 下一页按钮
        paginationHtml += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}"><i class="fas fa-chevron-right"></i></button>`;

        container.innerHTML = paginationHtml; 

        // 为分页按钮添加点击事件监听器
        container.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', function() { if (!this.disabled && this.dataset.page) { callback(parseInt(this.dataset.page)); } });
        });
    }

    // 加载聊天消息列表
    function loadMessages(page = 1) {
         currentMessagesPage = page;
         if (!messagesListContainer || !messagesPaginationContainer) return;
         showLoadingIndicator(messagesListContainer);
         messagesPaginationContainer.innerHTML = '';
         fetch(`/api/messages?page=${page}&page_size=50`)
            .then(r => r.json())
            .then(d => {
                if (!d.messages || d.messages.length === 0) { showNoResults(messagesListContainer, "没有聊天记录"); return; } // 无消息处理
                // 构建消息列表 HTML
                let h = `<div class="results-summary">共 ${formatNumber(d.total)} 条记录 (第 ${d.page}/${d.total_pages} 页)</div><div class="results-list">`;
                d.messages.forEach(msg => { h += renderResultItem(msg, false); });
                h += `</div>`;
                messagesListContainer.innerHTML = h; 
                renderPagination(d.page, d.total_pages, messagesPaginationContainer, loadMessages); // 渲染分页
                addInteractiveListeners(messagesListContainer, false); // 添加交互监听器
            })
            .catch(e => { showError(messagesListContainer, `加载聊天记录失败: ${e.message}`); console.error("[Messages] 加载消息错误:", e); }); // 显示错误
    }

    // 更新概览统计信息
    function updateStats() {
        fetch('/api/stats')
            .then(response => response.json())
            .then(data => {
                const messageCountEl = document.getElementById('messageCount');
                const contactCountEl = document.getElementById('contactCount');
                const groupCountEl = document.getElementById('groupCount');
                const fileCountEl = document.getElementById('fileCount'); // 假设这是 success_files
                const lastUpdateEl = document.getElementById('lastUpdateTime');
                // --- 添加通话记录统计元素 ---
                const callRecordCountEl = document.getElementById('callRecordCount'); // 需要在 HTML 中添加此 ID

                // 更新各统计项的文本内容
                if(messageCountEl) messageCountEl.textContent = formatNumber(data.messages_count || 0);
                if(contactCountEl) contactCountEl.textContent = formatNumber(data.contacts_count || 0);
                if(groupCountEl) groupCountEl.textContent = formatNumber(data.wechat_groups_count || 0);
                if(fileCountEl) fileCountEl.textContent = formatNumber(data.success_files || 0); // 假设 success_files 是正确的统计数据
                if(callRecordCountEl) callRecordCountEl.textContent = formatNumber(data.call_records_count || 0); // 更新通话记录

                // 更新最后更新时间
                if(lastUpdateEl) {
                    const now = new Date();
                    const formattedDate = `${now.getFullYear()}-${padZero(now.getMonth() + 1)}-${padZero(now.getDate())} ${padZero(now.getHours())}:${padZero(now.getMinutes())}`;
                    lastUpdateEl.textContent = '最后更新: ' + formattedDate;
                }
            })
            .catch(error => console.error('[Stats] 获取统计数据时出错:', error));
    }

    // --- 通话记录函数 ---

    // 设置通话记录选项卡内的控件事件
    function setupCallRecordControls() {
         if (updateCallChartBtn && callNumThresholdInput) {
              updateCallChartBtn.addEventListener('click', () => {
                  if (currentCallExcelId) { // 必须先有 Excel ID
                      const threshold = callNumThresholdInput.value;
                      fetchCallChartPreview(currentCallExcelId, threshold);
                  } else {
                      alert('请先加载通话记录数据。');
                  }
              });
         } else { console.warn("[CallRecords] 未找到更新图表按钮或阈值输入框。"); }

         // 下载 Excel 按钮
         if (downloadCallExcelBtn) {
              downloadCallExcelBtn.addEventListener('click', () => {
                  if (currentCallExcelId) {
                      window.location.href = `/api/call-records/download?type=excel&id=${encodeURIComponent(currentCallExcelId)}`; // 下载对应 Excel 文件
                  }
              });
         } else { console.warn("[CallRecords] 未找到下载 Excel 按钮。"); }

         // 下载图表按钮
         if (downloadCallChartBtn) {
              downloadCallChartBtn.addEventListener('click', () => {
                  if (currentCallChartId) { // 如果当前有图表 ID，直接下载
                       window.location.href = `/api/call-records/download?type=chart&id=${encodeURIComponent(currentCallChartId)}`;
                  } else if (currentCallExcelId) { // 如果没有图表 ID 但有 Excel ID，尝试生成再下载
                      alert("正在生成图表以下载...");
                      fetchCallChartPreview(currentCallExcelId, callNumThresholdInput?.value || 5); // 触发图表生成
                  } else {
                      alert('无图表可下载。');
                  }
              });
         } else { console.warn("[CallRecords] 未找到下载图表按钮。"); }
    }

    // 加载指定 Excel ID 的通话记录数据（统计、图表、排行）
    function loadCallRecordData(excelId) {
        if (!excelId) { showCallError('错误：未提供有效的通话记录文件ID。'); return; }
        currentCallExcelId = excelId; // 保存当前 Excel ID
        // 显示加载状态
        showLoadingIndicator(callSummaryStatsEl, '加载统计...');
        showLoadingIndicator(callChartContainerEl, '加载图表...');
        showLoadingIndicator(callTopContactsListEl, '加载排行...');
        if(callChartImageEl) callChartImageEl.style.display = 'none'; // 隐藏旧图表
        if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = true; // 禁用下载按钮
        if(downloadCallChartBtn) downloadCallChartBtn.disabled = true;

        // 请求通话记录的聚合数据
        fetch(`/api/call-records/all-call-records?excel_id=${encodeURIComponent(excelId)}`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    renderCallStats(data.stats); 
                    fetchCallChartPreview(excelId, callNumThresholdInput?.value || 5); 
                    renderTopContacts(data.stats.top_contacts); 
                    if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = false; // 启用 Excel 下载按钮
                } else { showCallError(`加载通话数据失败: ${data.message}`); } // 显示错误
            })
            .catch(error => { console.error('[CallRecords] 加载数据错误:', error); showCallError(`加载通话数据出错: ${error.message}`); }); // 显示错误
    }

    // 获取通话记录图表预览
    function fetchCallChartPreview(excelId, callNum) {、
         showLoadingIndicator(callChartContainerEl, '生成/加载图表...'); // 显示加载状态
         if(callChartImageEl) callChartImageEl.style.display = 'none'; // 隐藏旧图表
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = true; // 禁用图表下载

         // 请求更新（或生成）图表
         fetch('/api/call-records/update-chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excel_id: excelId, call_num: callNum }) })
         .then(response => response.json())
         .then(data => {
              if (data.status === 'success') {
                  renderCallChart(data.chart_data); // 渲染图表图片
                  currentCallChartId = data.chart_id; // 保存当前图表 ID
                  if(downloadCallChartBtn) downloadCallChartBtn.disabled = false; // 启用图表下载按钮
              } else { showError(callChartContainerEl, `加载图表失败: ${data.message}`); } // 显示错误
         })
         .catch(error => { console.error('[CallRecords] 获取图表错误:', error); showError(callChartContainerEl, `加载图表出错: ${error.message}`); }); // 显示错误
    }

    // 渲染通话统计信息
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

    // 渲染通话关系图表（显示图片）
    function renderCallChart(chartDataUrl) {
        if (!callChartContainerEl || !callChartImageEl) return;
        if (chartDataUrl) { // 如果有图表 URL
            callChartImageEl.src = chartDataUrl; // 设置图片源
            callChartImageEl.style.display = 'block'; // 显示图片
            callChartContainerEl.innerHTML = ''; // 清空加载指示器
            callChartContainerEl.appendChild(callChartImageEl); // 添加图片元素
        } else { // 如果没有 URL
            showError(callChartContainerEl, '无法加载图表数据。'); // 显示错误
            callChartImageEl.style.display = 'none'; // 隐藏图片元素
        }
    }

    // 渲染常用联系人列表
    function renderTopContacts(contacts) {
        if (!callTopContactsListEl) return;
        if (!contacts || contacts.length === 0) { callTopContactsListEl.innerHTML = '<p>无常用联系人数据</p>'; return; } // 无数据处理
        let listHtml = '<ul>';
        contacts.forEach(contact => { // 遍历联系人数据生成列表项
            listHtml += `<li>${escapeHtml(contact.phone)} (${contact.call_count}次, ${contact.total_duration})</li>`;
        });
        listHtml += '</ul>';
        callTopContactsListEl.innerHTML = listHtml; // 更新列表内容
    }

    // 在通话记录选项卡显示错误信息
    function showCallError(message) {
         if(callSummaryStatsEl) showError(callSummaryStatsEl, message); // 在统计区域显示
         if(callChartContainerEl) callChartContainerEl.innerHTML = ''; // 清空图表区域
         if(callTopContactsListEl) callTopContactsListEl.innerHTML = ''; // 清空排行区域
         if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = true; // 禁用下载按钮
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = true;
    }

    // 文件上传成功后的处理（主要用于通话记录）
    function handleSuccessfulUpload(taskId, generatedExcelId, generatedChartId) {
         if (generatedExcelId) {
             localStorage.setItem('lastCallExcelId', generatedExcelId); // 保存 Excel ID 到本地存储
             currentCallExcelId = generatedExcelId; // 更新当前 Excel ID
         }
         if (generatedChartId) {
             currentCallChartId = generatedChartId; // 更新当前 Chart ID
         }
         // 如果当前活动选项卡是通话记录，则重新加载数据
         const activeTabButton = document.querySelector('.tab-button.active');
         if (activeTabButton && activeTabButton.getAttribute('data-tab') === 'callRecordsTab' && currentCallExcelId) {
             loadCallRecordData(currentCallExcelId);
         }
         // 根据是否有 ID 启用/禁用下载按钮
         if(downloadCallExcelBtn) downloadCallExcelBtn.disabled = !currentCallExcelId;
         if(downloadCallChartBtn) downloadCallChartBtn.disabled = !currentCallChartId && !currentCallExcelId; // 如果图表已存在或可生成，则启用
    }

    // --- 工具函数 ---
    function escapeHtml(unsafe) { if (unsafe === null || unsafe === undefined) return ''; return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); } 
    function formatTime(timeStr) { if (!timeStr || timeStr === 'None' || timeStr === 'NaT') return '未知时间'; try { let d=new Date(timeStr); if(isNaN(d.getTime())){ if(/^\d{10}$/.test(timeStr))d=new Date(parseInt(timeStr,10)*1000); else if(/^\d{13}$/.test(timeStr))d=new Date(parseInt(timeStr,10)); else if(isNaN(d.getTime()))return timeStr; } return d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); } catch(e){return timeStr;} } // 格式化时间
    function formatNumber(num) { return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); } 
    function padZero(num) { return num < 10 ? '0' + num : num; } 
    function showLoadingIndicator(container, message = '加载中...') { if(container) container.innerHTML = `<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><p>${message}</p></div>`; } 
    function showError(container, message) { if(container) container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle"></i><p>${message}</p></div>`; } 
    function showNoResults(container, message) { if(container) container.innerHTML = `<div class="no-results-message"><i class="fas fa-search"></i><p>${message}</p></div>`; }

    // --- 初始数据加载 ---
    updateStats(); // 页面加载时更新统计信息
    loadSearchHistory(); // 加载搜索历史
}); // DOMContentLoaded 结束
