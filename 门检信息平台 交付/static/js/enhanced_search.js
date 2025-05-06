document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('keywordSearch'); 
    const searchButton = document.getElementById('searchButton'); 
    const searchResultsContainer = document.getElementById('searchResults'); 
    const searchTypeSelect = document.getElementById('searchTypeSelect');

    let currentPage = 1;
    let currentQuery = '';
    let currentSearchType = 'combined'; 

    // --- 初始化 ---
    setupSearchControls();

    // --- 设置搜索控件事件 ---
    function setupSearchControls() {
        if (searchButton) {
            searchButton.addEventListener('click', startSearch);
        }
        if (searchInput) {
            searchInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    startSearch();
                }
            });
             // 可以在输入框聚焦时加载搜索历史
             searchInput.addEventListener('focus', loadSearchHistorySuggestions);
        }
        if (searchTypeSelect) {
            searchTypeSelect.addEventListener('change', function() {
                currentSearchType = this.value;
                // 如果已有查询词，可以自动重新搜索
            });
        }
         const historySuggestionsContainer = document.getElementById('searchHistorySuggestions'); 
         if (historySuggestionsContainer) {
             historySuggestionsContainer.addEventListener('click', function(e) {
                 if (e.target.classList.contains('suggestion-item')) {
                     searchInput.value = e.target.textContent;
                     historySuggestionsContainer.style.display = 'none'; // 隐藏建议列表
                     startSearch(); // 点击建议后立即搜索
                 }
             });
             // 点击外部隐藏建议
             document.addEventListener('click', function(e) {
                  if (!searchInput.contains(e.target) && !historySuggestionsContainer.contains(e.target)) {
                      historySuggestionsContainer.style.display = 'none';
                  }
              });
         }
    }

    // --- 搜索历史建议 ---
    function loadSearchHistorySuggestions() {
         const container = document.getElementById('searchHistorySuggestions');
         if (!container) return;

         fetch('/api/search-history')
             .then(response => response.json())
             .then(data => {
                 if (data.search_history && data.search_history.length > 0) {
                     const limitedHistory = data.search_history.slice(0, 5); // 最多显示5条
                     container.innerHTML = limitedHistory
                         .map(item => `<div class="suggestion-item">${escapeHtml(item)}</div>`)
                         .join('');
                     container.style.display = 'block'; // 显示建议列表
                 } else {
                     container.style.display = 'none'; // 隐藏列表
                 }
             })
             .catch(error => {
                 console.error("Load search history suggestions error:", error);
                 container.style.display = 'none';
             });
     }


    // --- 搜索执行与显示 ---
    function startSearch() {
        currentPage = 1; // 重置页码
        currentQuery = searchInput ? searchInput.value.trim() : '';
        currentSearchType = searchTypeSelect ? searchTypeSelect.value : 'combined';

        if (!currentQuery) {
            if (searchResultsContainer) searchResultsContainer.innerHTML = '<p>请输入搜索关键词。</p>';
            return;
        }

        if (searchResultsContainer) searchResultsContainer.innerHTML = '<div class="loading">搜索中，请稍候...</div>';

        // 隐藏历史建议
        const historySuggestionsContainer = document.getElementById('searchHistorySuggestions');
        if(historySuggestionsContainer) historySuggestionsContainer.style.display = 'none';

        performSearch();
    }

    function performSearch() {
        if (!searchResultsContainer) return;

        const apiUrl = `/api/search?q=${encodeURIComponent(currentQuery)}&page=${currentPage}&page_size=20&type=${currentSearchType}&context_size=3`; // 每页20条

        fetch(apiUrl)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                displaySearchResults(data);
            })
            .catch(error => {
                searchResultsContainer.innerHTML = `<div class="error">搜索出错: ${error.message}</div>`;
                console.error('Search error:', error);
            });
    }

    function displaySearchResults(data) {
        if (!searchResultsContainer) return;

        const results = data.results || [];

        if (results.length === 0 && currentPage === 1) { // 只有第一页没结果才显示“无结果”
            searchResultsContainer.innerHTML = '<div class="no-results">没有找到与 "<strong>' + escapeHtml(currentQuery) + '</strong>" 相关的结果。</div>';
            return;
        }

        let resultsHTML = '';
        if (currentPage === 1) { // 只在第一页显示摘要
             resultsHTML += `<div class="results-summary">找到 ${data.total || 0} 个结果 (搜索类型: ${getSearchTypeDisplay(data.search_type)})</div>`;
        }
        resultsHTML += '<div class="results-list">'; 

        results.forEach(result => {
             // 确保 result.data 存在
             if (!result || !result.data) {
                 console.warn("Invalid search result structure:", result);
                 return; // 跳过无效项
             }
             resultsHTML += renderResultItem(result.data, false); 
        });

        resultsHTML += '</div>'; 
        
        // 添加分页
        if (data.total_pages > 1) {
            resultsHTML += createPagination(data.page, data.total_pages, 'search'); 

        searchResultsContainer.innerHTML = resultsHTML;

        addPaginationListeners(searchResultsContainer.querySelector('.pagination'), performSearch, 'search'); 
        addFavoriteButtonListeners(searchResultsContainer); 
    }

    // --- 收藏夹按钮逻辑 (复用或独立实现) ---
    function addFavorite(type, id, buttonElement) {
        // (与 main.js 中的 addFavorite 逻辑相同)
         fetch('/api/favorites/add', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ type: type, id: id })
         })
         .then(response => response.json())
         .then(data => {
             if (data.status === 'success' || data.status === 'info') {
                 if (buttonElement) {
                     buttonElement.textContent = '取消收藏';
                     buttonElement.classList.add('is-favorite');
                     buttonElement.removeEventListener('click', handleAddFavoriteClick);
                     buttonElement.addEventListener('click', handleRemoveFavoriteClick);
                 }
             } else { alert('添加收藏失败: ' + (data.message || '未知错误')); }
         })
         .catch(error => { alert('添加收藏请求失败'); console.error("Add favorite error:", error); });
    }

    function removeFavorite(type, id, buttonElement, isInFavoritesList = false) {
          fetch('/api/favorites/remove', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: type, id: id })
          })
          .then(response => response.json())
          .then(data => {
              if (data.status === 'success') {
                  if (buttonElement) {
                      buttonElement.textContent = '收藏';
                      buttonElement.classList.remove('is-favorite');
                      buttonElement.removeEventListener('click', handleRemoveFavoriteClick);
                      buttonElement.addEventListener('click', handleAddFavoriteClick);
                  }
              } else { alert('移除收藏失败: ' + (data.message || '未知错误')); }
          })
          .catch(error => { alert('移除收藏请求失败'); console.error("Remove favorite error:", error); });
    }

     // --- 事件处理函数 ---
     function handleAddFavoriteClick(event) {
         const button = event.target;
         const type = button.getAttribute('data-type');
         const id = button.getAttribute('data-id');
         if (type && id) {
             addFavorite(type, id, button);
         }
     }

     function handleRemoveFavoriteClick(event) {
         const button = event.target;
         const type = button.getAttribute('data-type');
         const id = button.getAttribute('data-id');
         if (type && id) {
             removeFavorite(type, id, button, false); 
         }
     }

     function addFavoriteButtonListeners(container) {
         if (!container) return;
         container.querySelectorAll('.favorite-button').forEach(button => {
             button.removeEventListener('click', handleAddFavoriteClick);
             button.removeEventListener('click', handleRemoveFavoriteClick);
             if (button.classList.contains('is-favorite')) {
                 button.addEventListener('click', handleRemoveFavoriteClick);
             } else {
                 button.addEventListener('click', handleAddFavoriteClick);
             }
         });
         
          container.querySelectorAll('.show-context-btn').forEach(button => {
              const listener = () => {
                  const resultId = button.getAttribute('data-result-id');
                  const contextDiv = document.getElementById(`context-${resultId}`); // 假设 ID 在全局唯一
                  if (contextDiv) {
                      const isVisible = contextDiv.style.display !== 'none';
                      contextDiv.style.display = isVisible ? 'none' : 'block';
                      button.textContent = isVisible ? '显示上下文' : '隐藏上下文';
                  }
              };
              button.replaceWith(button.cloneNode(true));
              const newButton = container.querySelector(`.show-context-btn[data-result-id="${button.getAttribute('data-result-id')}"]`);
              if(newButton) newButton.addEventListener('click', listener);
          });
     }


    // --- 辅助函数 ---

    // 渲染单个结果项 (需要与 main.js 中的版本保持一致或共享)
    function renderResultItem(metadata, isInFavoritesList = false) {
         if (!metadata || !metadata.type) return '';
         const type = metadata.type;
         const id = metadata.id || metadata.group_id || metadata.wechat_id || uuid.v4();
         const isFavorite = metadata.is_favorite || isInFavoritesList; 
         let content = '';
         let headerInfo = '';
         let footerInfo = '';
         let highlightedContent = '';

         try {
             switch (type) {
                 case 'message':
                     headerInfo = `<span class="sender">${escapeHtml(metadata.sender) || '未知'}</span> <span class="time">${formatTime(metadata.time)}</span>`;
                     highlightedContent = metadata.highlighted_content || escapeHtml(metadata.content) || '';
                     content = `<div class="result-content">${highlightedContent}</div>`;
                     footerInfo = `<span class="source">来源: ${escapeHtml(metadata.source) || '未知'}</span>`;
                     if (metadata.score !== undefined) footerInfo += ` <span class="score">得分: ${metadata.score.toFixed(2)}</span>`;
                     if (!isInFavoritesList && metadata.conversation_context && metadata.conversation_context.length > 0) {
                          footerInfo += ` <button class="show-context-btn" data-result-id="${id}">显示上下文</button>`;
                          footerInfo += `<div class="conversation-context" id="context-${id}" style="display:none;">`;
                          metadata.conversation_context.forEach(msg => {
                              const msgClass = msg.is_sent ? 'message-sent' : 'message-received';
                              const msgContent = msg.highlighted_content || escapeHtml(msg.content) || '';
                              const currentMsgClass = msg.is_current_message ? ' current-context-message' : '';
                              footerInfo += `
                              <div class="message ${msgClass}${currentMsgClass}">
                                  <div class="message-sender">${escapeHtml(msg.sender) || '未知'}</div>
                                  <div class="message-content">${msgContent}</div>
                                  <div class="message-time">${formatTime(msg.time)}</div>
                              </div>`;
                          });
                          footerInfo += `</div>`;
                     }
                     break;
                 case 'contact':
                     headerInfo = `<span class="name">${escapeHtml(metadata.name) || '未知'}</span> <span class="badge">联系人</span>`;
                     content = `<div class="result-content">电话: ${escapeHtml(metadata.phone) || '无'}</div>`;
                     if (metadata.score !== undefined) footerInfo = `<span class="score">得分: ${metadata.score.toFixed(2)}</span>`;
                     break;
                 case 'wechat_group':
                     headerInfo = `<span class="name">${escapeHtml(metadata.group_name) || '未知'}</span> <span class="badge">微信群组</span>`;
                     content = `<div class="result-content">`;
                     if (metadata.announcement) content += `公告: ${escapeHtml(metadata.announcement)}<br>`;
                     if (metadata.member_count) content += `成员: ${metadata.member_count}`;
                     content += `</div>`;
                     if (metadata.score !== undefined) footerInfo = `<span class="score">得分: ${metadata.score.toFixed(2)}</span>`;
                     break;
                 case 'wechat_contact':
                     headerInfo = `<span class="name">${escapeHtml(metadata.nickname) || escapeHtml(metadata.remark) || '未知'}</span> <span class="badge">微信联系人</span>`;
                     content = `<div class="result-content">`;
                     if (metadata.phone) content += `电话: ${escapeHtml(metadata.phone)}<br>`;
                     if (metadata.group_name) content += `群组: ${escapeHtml(metadata.group_name)}`;
                     content += `</div>`;
                     if (metadata.score !== undefined) footerInfo = `<span class="score">得分: ${metadata.score.toFixed(2)}</span>`;
                     break;
                 case 'app_summary':
                      headerInfo = `<span class="name">${escapeHtml(metadata.name) || '未知'}</span> <span class="badge">应用摘要</span>`;
                      content = `<div class="result-content">`;
                      if (metadata.details) {
                          content += Object.entries(metadata.details).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('<br>');
                      }
                      content += `</div>`;
                      if (metadata.score !== undefined) footerInfo = `<span class="score">得分: ${metadata.score.toFixed(2)}</span>`;
                      break;
                 default:
                     headerInfo = `<span class="name">未知类型: ${escapeHtml(type)}</span>`;
                     content = `<div class="result-content">${escapeHtml(JSON.stringify(metadata)).substring(0, 100)}...</div>`;
             }
         } catch (error) {
             console.error("Error rendering item:", error, metadata);
             content = `<div class="result-content error">渲染此项时出错</div>`;
         }

         const favButtonText = isFavorite ? '取消收藏' : '收藏';
         const favButtonClass = isFavorite ? 'favorite-button is-favorite' : 'favorite-button';
         const favoriteButtonHtml = `<button class="${favButtonClass}" data-type="${type}" data-id="${id}">${favButtonText}</button>`;

         return `
             <div class="result-item" data-item-id="${id}" data-item-type="${type}">
                 <div class="result-header">
                     ${headerInfo}
                     ${favoriteButtonHtml}
                 </div>
                 ${content}
                 <div class="result-footer">${footerInfo}</div>
             </div>
         `;
     }

    // 分页HTML
    function createPagination(currentPage, totalPages, source = 'search') {
         if (totalPages <= 1) return '';
         let html = `<div class="pagination" data-pagination-source="${source}">`;
         html += `<button data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&laquo; 上一页</button>`;
         const maxPagesToShow = 5;
         let startPage, endPage;
         if (totalPages <= maxPagesToShow) { startPage = 1; endPage = totalPages; }
         else {
             const maxPagesBefore = Math.floor(maxPagesToShow / 2);
             const maxPagesAfter = Math.ceil(maxPagesToShow / 2) - 1;
             if (currentPage <= maxPagesBefore) { startPage = 1; endPage = maxPagesToShow; }
             else if (currentPage + maxPagesAfter >= totalPages) { startPage = totalPages - maxPagesToShow + 1; endPage = totalPages; }
             else { startPage = currentPage - maxPagesBefore; endPage = currentPage + maxPagesAfter; }
         }
         if (startPage > 1) {
             html += `<button data-page="1">1</button>`;
             if (startPage > 2) html += `<span class="page-ellipsis">...</span>`;
         }
         for (let i = startPage; i <= endPage; i++) {
             html += `<button data-page="${i}" ${i === currentPage ? 'class="active"' : ''}>${i}</button>`;
         }
         if (endPage < totalPages) {
             if (endPage < totalPages - 1) html += `<span class="page-ellipsis">...</span>`;
             html += `<button data-page="${totalPages}">${totalPages}</button>`;
         }
         html += `<button data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>下一页 &raquo;</button>`;
         html += '</div>';
         return html;
     }
     function addPaginationListeners(container, loadFunction, source) {
          if (!container) return;
          container.querySelectorAll('button[data-page]').forEach(button => {
              button.addEventListener('click', function() {
                  if (this.disabled) return;
                  currentPage = parseInt(this.getAttribute('data-page')); // 更新当前页
                  loadFunction();

                  // 滚动到结果列表顶部
                  if(searchResultsContainer) searchResultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
          });
      }


    // HTML 转义函数
    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // 格式化时间函数
    function formatTime(timeStr) {
         if (!timeStr || timeStr === 'None' || timeStr === 'NaT') return '未知时间';
         try {
             let date = new Date(timeStr);
             if (isNaN(date.getTime())) {
                  if (/^\d{10}$/.test(timeStr)) date = new Date(parseInt(timeStr) * 1000);
                  else if (/^\d{13}$/.test(timeStr)) date = new Date(parseInt(timeStr));
                  else if (isNaN(date.getTime())) return timeStr;
             }
             return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
         } catch (e) { return timeStr; }
     }

    // 搜索显示文本
    function getSearchTypeDisplay(type) {
        const typeMap = { 'combined': '混合', 'keyword': '关键词', 'semantic': '语义', 'sender': '发送者' };
        return typeMap[type] || type;
    }
});
