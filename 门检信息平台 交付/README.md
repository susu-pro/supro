# 信息检索平台集成指南

## 系统架构

```
信息检索平台/
├── main.py                    # 主Flask应用
├── templates/
│   └── index.html            # 前端界面
├── static/
│   ├── css/
│   ├── js/
│   └── results/              # 结果文件目录
│       ├── charts/           # 图表文件
│       └── excel/            # Excel导出文件
├── api/                      # API模块
│   ├── __init__.py
│   ├── call_records.py       # 通话记录API
│   └── browser_history.py    # 浏览器历史API
├── uploads/                  # 上传文件临时目录
├── app_data_persistence.json # 持久化数据
└── requirements.txt          # 依赖包
```

## 现有功能模块

### 核心功能
1. **文件上传与处理** - 支持JSON格式的手机取证数据
2. **智能搜索** - BM25 + TF-IDF混合搜索算法
3. **数据可视化** - 统计图表和数据展示
4. **收藏夹系统** - 支持收藏重要记录
5. **搜索历史** - 自动保存搜索记录

### 数据类型支持
- 聊天消息（微信、QQ等）
- 联系人信息
- 微信群组和联系人
- 通话记录
- 浏览器历史记录

## 新增模块集成

### 1. 浏览器历史记录模块

#### 1.1 创建API模块
创建 `api/browser_history.py`：

```python
from flask import Blueprint, jsonify, request
import pandas as pd
from collections import Counter
import logging

browser_history_bp = Blueprint('browser_history', __name__)

@browser_history_bp.route('/stats')
def get_browser_stats():
    """获取浏览器历史统计"""
    try:
        from main import app_data, search_engine
        
        browser_data = app_data.get('browser_history', [])
        if not browser_data:
            return jsonify({
                'total_records': 0,
                'domain_stats': {},
                'daily_stats': {},
                'top_sites': []
            })
        
        # 统计数据
        total_records = len(browser_data)
        
        # 域名统计
        domains = []
        for record in browser_data:
            url = record.get('url', '')
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc
                if domain:
                    domains.append(domain)
            except:
                continue
        
        domain_stats = dict(Counter(domains).most_common(20))
        
        # 访问时间统计
        df = pd.DataFrame(browser_data)
        daily_stats = {}
        if 'visit_time' in df.columns:
            df['visit_time'] = pd.to_datetime(df['visit_time'], errors='coerce')
            df = df.dropna(subset=['visit_time'])
            if not df.empty:
                df['date'] = df['visit_time'].dt.date
                daily_stats = df['date'].value_counts().sort_index().to_dict()
                daily_stats = {str(k): int(v) for k, v in daily_stats.items()}
        
        # 热门网站
        title_counts = Counter()
        for record in browser_data:
            title = record.get('title', '').strip()
            if title and len(title) > 0:
                title_counts[title] += 1
        
        top_sites = [{'title': k, 'count': v} for k, v in title_counts.most_common(10)]
        
        return jsonify({
            'total_records': total_records,
            'domain_stats': domain_stats,
            'daily_stats': daily_stats,
            'top_sites': top_sites
        })
        
    except Exception as e:
        logging.error(f"获取浏览器统计时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@browser_history_bp.route('/search')
def search_browser_history():
    """搜索浏览器历史"""
    try:
        from main import app_data
        
        query = request.args.get('q', '').strip()
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 20, type=int)
        
        browser_data = app_data.get('browser_history', [])
        
        if query:
            # 简单的关键词匹配
            filtered_data = []
            for record in browser_data:
                title = record.get('title', '').lower()
                url = record.get('url', '').lower()
                if query.lower() in title or query.lower() in url:
                    filtered_data.append(record)
            browser_data = filtered_data
        
        # 分页
        total = len(browser_data)
        start_idx = (page - 1) * page_size
        end_idx = page * page_size
        paged_data = browser_data[start_idx:end_idx]
        
        return jsonify({
            'results': paged_data,
            'page': page,
            'page_size': page_size,
            'total': total,
            'total_pages': (total + page_size - 1) // page_size if page_size > 0 else 1,
            'query': query
        })
        
    except Exception as e:
        logging.error(f"搜索浏览器历史时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@browser_history_bp.route('/export')
def export_browser_history():
    """导出浏览器历史"""
    try:
        from main import app_data
        import os
        
        browser_data = app_data.get('browser_history', [])
        if not browser_data:
            return jsonify({'error': '没有浏览器历史数据'}), 404
        
        # 创建Excel文件
        df = pd.DataFrame(browser_data)
        excel_path = 'static/results/excel/browser_history.xlsx'
        os.makedirs(os.path.dirname(excel_path), exist_ok=True)
        
        df.to_excel(excel_path, index=False, engine='openpyxl')
        
        return jsonify({
            'status': 'success',
            'download_url': f'/static/results/excel/browser_history.xlsx',
            'record_count': len(browser_data)
        })
        
    except Exception as e:
        logging.error(f"导出浏览器历史时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
```

#### 1.2 在main.py中注册蓝图
在main.py中添加：

```python
# 在导入部分添加
from api.browser_history import browser_history_bp

# 在蓝图注册部分添加
app.register_blueprint(browser_history_bp, url_prefix='/api/browser-history')
```

#### 1.3 数据提取函数
在main.py的数据提取部分添加：

```python
def extract_browser_history(data, file_path):
    """提取浏览器历史记录"""
    browser_history = []
    file_basename = os.path.basename(file_path)
    
    # 检查是否为浏览器历史数据
    is_browser_data = False
    if isinstance(data, dict) and isinstance(data.get('parents'), list):
        for parent in data['parents']:
            if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
               any(keyword in parent[0].lower() for keyword in ['浏览', 'browser', 'history', '历史']):
                is_browser_data = True
                break
    
    if is_browser_data and isinstance(data.get('contents'), dict):
        actual_contents = data['contents'].get('contents')
        if isinstance(actual_contents, list):
            for history_entry in actual_contents:
                if isinstance(history_entry, list) and len(history_entry) >= 3:
                    history_record = {
                        'id': history_entry[0][1] if len(history_entry[0]) > 1 else str(uuid.uuid4()),
                        'title': history_entry[1][1] if len(history_entry[1]) > 1 else 'Unknown',
                        'url': '',
                        'visit_time': '',
                        'visit_count': 0,
                        'details': {},
                        'source_file': file_basename
                    }
                    
                    if len(history_entry) > 2 and isinstance(history_entry[2], list) and len(history_entry[2]) > 0:
                        details_list = history_entry[2][0]
                        if isinstance(details_list, list):
                            for detail_item in details_list:
                                if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                    key, value = detail_item[0], detail_item[1]
                                    history_record['details'][key] = value
                                    
                                    # 映射常见字段
                                    if 'url' in key.lower() or '网址' in key:
                                        history_record['url'] = value
                                    elif '时间' in key or 'time' in key.lower():
                                        history_record['visit_time'] = value
                                    elif '次数' in key or 'count' in key.lower():
                                        try:
                                            history_record['visit_count'] = int(value)
                                        except:
                                            pass
                    
                    browser_history.append(history_record)
    
    return browser_history
```

#### 1.4 更新process_file函数
修改process_file函数以包含浏览器历史：

```python
def process_file(file_path):
    # ... 现有代码 ...
    
    # 添加浏览器历史提取
    browser_history = extract_browser_history(data, file_path)
    
    return device_info, contacts, messages, app_summary, wechat_groups, wechat_contacts, call_records, browser_history
```

### 2. 通话记录模块完善

#### 2.1 完善call_records.py
创建完整的 `api/call_records.py`：

```python
from flask import Blueprint, jsonify, request, send_file
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # 非交互式后端
import seaborn as sns
from collections import Counter, defaultdict
import os
import logging

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

call_records_bp = Blueprint('call_records', __name__)

@call_records_bp.route('/stats')
def get_call_stats():
    """获取通话记录统计"""
    try:
        from main import app_data
        
        call_data = app_data.get('call_records', [])
        if not call_data:
            return jsonify({
                'total_calls': 0,
                'incoming_calls': 0,
                'outgoing_calls': 0,
                'missed_calls': 0,
                'total_duration': 0,
                'top_contacts': [],
                'call_frequency': {}
            })
        
        # 统计数据
        total_calls = len(call_data)
        call_types = Counter()
        durations = []
        phone_counts = Counter()
        
        for record in call_data:
            call_type = record.get('call_type', '').lower()
            call_types[call_type] += 1
            
            duration = record.get('duration', 0)
            try:
                if isinstance(duration, str):
                    # 解析时长字符串，如 "2分30秒"
                    import re
                    minutes = re.findall(r'(\d+)分', duration)
                    seconds = re.findall(r'(\d+)秒', duration)
                    total_seconds = 0
                    if minutes:
                        total_seconds += int(minutes[0]) * 60
                    if seconds:
                        total_seconds += int(seconds[0])
                    durations.append(total_seconds)
                else:
                    durations.append(int(duration))
            except:
                durations.append(0)
            
            phone = record.get('phone', '')
            if phone:
                phone_counts[phone] += 1
        
        # 热门联系人
        top_contacts = [{'phone': k, 'count': v} for k, v in phone_counts.most_common(10)]
        
        return jsonify({
            'total_calls': total_calls,
            'incoming_calls': call_types.get('incoming', 0) + call_types.get('来电', 0),
            'outgoing_calls': call_types.get('outgoing', 0) + call_types.get('去电', 0),
            'missed_calls': call_types.get('missed', 0) + call_types.get('未接', 0),
            'total_duration': sum(durations),
            'top_contacts': top_contacts,
            'call_types': dict(call_types)
        })
        
    except Exception as e:
        logging.error(f"获取通话统计时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@call_records_bp.route('/generate-charts')
def generate_call_charts():
    """生成通话记录图表"""
    try:
        from main import app_data
        
        call_data = app_data.get('call_records', [])
        if not call_data:
            return jsonify({'error': '没有通话记录数据'}), 404
        
        # 确保目录存在
        charts_dir = 'static/results/charts'
        os.makedirs(charts_dir, exist_ok=True)
        
        df = pd.DataFrame(call_data)
        
        # 统计电话号码出现频次
        phone_counts = df['phone'].value_counts()
        
        # 生成不同频次的图表
        for min_count in [2, 5, 10]:
            frequent_phones = phone_counts[phone_counts >= min_count]
            
            if len(frequent_phones) > 0:
                plt.figure(figsize=(12, 8))
                
                # 限制显示数量
                top_phones = frequent_phones.head(20)
                
                # 创建柱状图
                bars = plt.bar(range(len(top_phones)), top_phones.values)
                plt.xlabel('联系人电话')
                plt.ylabel('通话次数')
                plt.title(f'机主通话信息图({min_count}次以上)')
                plt.xticks(range(len(top_phones)), 
                          [f'{phone[:3]}***{phone[-4:]}' if len(phone) > 7 else phone 
                           for phone in top_phones.index], 
                          rotation=45, ha='right')
                
                # 添加数值标签
                for i, bar in enumerate(bars):
                    height = bar.get_height()
                    plt.text(bar.get_x() + bar.get_width()/2., height + 0.1,
                            f'{int(height)}', ha='center', va='bottom')
                
                plt.tight_layout()
                plt.savefig(f'{charts_dir}/call_info(num_{min_count}).png', 
                           dpi=300, bbox_inches='tight')
                plt.close()
        
        # 生成通话类型分布图
        call_types = df['call_type'].value_counts()
        if len(call_types) > 0:
            plt.figure(figsize=(10, 6))
            plt.pie(call_types.values, labels=call_types.index, autopct='%1.1f%%')
            plt.title('通话类型分布')
            plt.savefig(f'{charts_dir}/call_types_distribution.png', 
                       dpi=300, bbox_inches='tight')
            plt.close()
        
        return jsonify({
            'status': 'success',
            'message': '图表生成完成',
            'charts': [
                'call_info(num_2).png',
                'call_info(num_5).png', 
                'call_info(num_10).png',
                'call_types_distribution.png'
            ]
        })
        
    except Exception as e:
        logging.error(f"生成图表时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@call_records_bp.route('/export')
def export_call_records():
    """导出通话记录Excel"""
    try:
        from main import app_data
        
        call_data = app_data.get('call_records', [])
        if not call_data:
            return jsonify({'error': '没有通话记录数据'}), 404
        
        # 创建Excel文件
        df = pd.DataFrame(call_data)
        excel_path = 'static/results/excel/call_log_output.xlsx'
        os.makedirs(os.path.dirname(excel_path), exist_ok=True)
        
        # 添加一些数据处理
        if 'time' in df.columns:
            df['时间'] = pd.to_datetime(df['time'], errors='coerce')
        
        # 重命名列名为中文
        column_mapping = {
            'phone': '电话号码',
            'call_type': '通话类型', 
            'duration': '通话时长',
            'time': '通话时间',
            'is_deleted': '是否删除'
        }
        
        df_export = df.rename(columns=column_mapping)
        df_export.to_excel(excel_path, index=False, engine='openpyxl')
        
        return jsonify({
            'status': 'success',
            'download_url': f'/static/results/excel/call_log_output.xlsx',
            'record_count': len(call_data)
        })
        
    except Exception as e:
        logging.error(f"导出通话记录时出错: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
```

### 3. 更新主文件main.py

#### 3.1 更新app_data结构
```python
app_data = {
    'device_info': {},
    'contacts': [],
    'messages': [],
    'app_summary': [],
    'wechat_groups': [],
    'wechat_contacts': [],
    'call_records': [],
    'browser_history': [],  # 新增
    'search_history': [],
    'favorites': []
}
```

#### 3.2 更新process_batch_files函数
```python
def process_batch_files(file_paths, task_id=None):
    """处理文件并合并数据"""
    batch_data = {
        'device_info': {}, 'contacts': [], 'messages': [], 'app_summary': [],
        'wechat_groups': [], 'wechat_contacts': [], 'call_records': [], 
        'browser_history': []  # 新增
    }
    # ... 现有代码 ...
    
    for file_path in file_paths:
        # ... 现有代码 ...
        try:
            results = process_file(file_path)
            if len(results) >= 7:  # 确保有足够的返回值
                # ... 现有的数据合并代码 ...
                if isinstance(results[7], list): 
                    batch_data['browser_history'].extend(results[7])
```

#### 3.3 更新统计API
```python
@app.route('/api/stats')
def get_stats():
    # 各类数据的统计计数
    return jsonify({
        'contacts_count': len(app_data.get('contacts', [])),
        'messages_count': len(app_data.get('messages', [])),
        'app_summary_count': len(app_data.get('app_summary', [])),
        'wechat_groups_count': len(app_data.get('wechat_groups', [])),
        'wechat_contacts_count': len(app_data.get('wechat_contacts', [])),
        'call_records_count': len(app_data.get('call_records', [])),
        'browser_history_count': len(app_data.get('browser_history', []))  # 新增
    })
```

### 4. 前端集成

#### 4.1 更新HTML模板
在index.html的标签页内容中更新：

```html
<!-- 通话记录标签页 -->
<div class="tab-content" id="callRecordsTab"> 
    <h3>通话记录</h3>
    <div class="call-controls">
        <button class="btn btn-primary" id="generateCallCharts">
            <i class="fas fa-chart-bar"></i> 生成图表
        </button>
        <button class="btn btn-secondary" id="exportCallRecords">
            <i class="fas fa-file-excel"></i> 导出Excel
        </button>
    </div>
    
    <div class="call-stats" id="callStats">
        <div class="loading-indicator">
            <p>加载统计数据中...</p>
        </div>
    </div>
    
    <div class="call-records-chart-container">
        <div id="callChartsContainer">
            <p>点击"生成图表"按钮来创建通话分析图表</p>
        </div>
    </div>
</div>

<!-- 浏览记录标签页 -->
<div class="tab-content" id="browsingHistoryTab">
    <h3>浏览记录</h3>
    <div class="browser-controls">
        <div class="search-box">
            <input type="search" id="browserSearch" class="search-input" placeholder="搜索网页标题或URL...">
            <button class="btn btn-primary" id="searchBrowserHistory">
                <i class="fas fa-search"></i> 搜索
            </button>
        </div>
        <button class="btn btn-secondary" id="exportBrowserHistory">
            <i class="fas fa-file-excel"></i> 导出Excel
        </button>
    </div>
    
    <div class="browser-stats" id="browserStats">
        <div class="loading-indicator">
            <p>加载统计数据中...</p>
        </div>
    </div>
    
    <div id="browsingHistoryList" class="results-container">
        <div class="no-results-message">
            <p>请搜索浏览记录或查看统计信息</p>
        </div>
    </div>
    <div id="browserPagination" class="pagination"></div>
</div>
```

#### 4.2 添加JavaScript功能
在script标签中添加：

```javascript
// 通话记录功能
document.getElementById('generateCallCharts').addEventListener('click', function() {
    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
    this.disabled = true;
    
    fetch('/api/call-records/generate-charts', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                loadCallCharts();
                alert('图表生成完成！');
            } else {
                alert('生成失败: ' + data.error);
            }
        })
        .catch(error => {
            alert('生成出错: ' + error.message);
        })
        .finally(() => {
            this.innerHTML = '<i class="fas fa-chart-bar"></i> 生成图表';
            this.disabled = false;
        });
});

// 浏览器历史搜索
document.getElementById('searchBrowserHistory').addEventListener('click', function() {
    const query = document.getElementById('browserSearch').value.trim();
    searchBrowserHistory(query, 1);
});

function loadCallStats() {
    fetch('/api/call-records/stats')
        .then(response => response.json())
        .then(data => {
            renderCallStats(data);
        })
        .catch(error => {
            document.getElementById('callStats').innerHTML = 
                `<div class="error-message">加载通话统计失败: ${error.message}</div>`;
        });
}

function loadBrowserStats() {
    fetch('/api/browser-history/stats')
        .then(response => response.json())
        .then(data => {
            renderBrowserStats(data);
        })
        .catch(error => {
            document.getElementById('browserStats').innerHTML = 
                `<div class="error-message">加载浏览统计失败: ${error.message}</div>`;
        });
}

function searchBrowserHistory(query, page = 1) {
    const url = `/api/browser-history/search?q=${encodeURIComponent(query)}&page=${page}&page_size=20`;
    
    fetch(url)
        .then(response => response.json())
        .then(data => {
            renderBrowserHistory(data);
            renderPagination(data.page, data.total_pages, 
                document.getElementById('browserPagination'), 
                (newPage) => searchBrowserHistory(query, newPage));
        })
        .catch(error => {
            showError(document.getElementById('browsingHistoryList'), 
                `搜索失败: ${error.message}`);
        });
}

// 在标签页切换事件中添加
if (tabId === 'callRecordsTab') {
    loadCallStats();
} else if (tabId === 'browsingHistoryTab') {
    loadBrowserStats();
}
```

### 5. 部署说明

#### 5.1 依赖安装
```bash
pip install flask pandas matplotlib seaborn openpyxl urllib3
```

#### 5.2 目录结构确保
```bash
mkdir -p static/results/charts
mkdir -p static/results/excel
mkdir -p api
mkdir -p uploads
```

#### 5.3 文件权限
```bash
chmod 755 static/results/
chmod 755 uploads/
```

### 6. 使用说明

1. **上传数据**: 将手机取证的JSON文件上传到系统
2. **查看统计**: 系统自动分析并显示各类数据统计
3. **搜索功能**: 使用智能搜索查找特定信息
4. **图表生成**: 点击生成按钮创建可视化图表
5. **数据导出**: 将分析结果导出为Excel文件

### 7. 故障排除

#### 常见问题
1. **图表不显示**: 检查matplotlib和seaborn安装
2. **中文乱码**: 确保系统安装了中文字体
3. **文件上传失败**: 检查uploads目录权限
4. **搜索无结果**: 确认数据格式和字段映射

#### 日志查看
```bash
tail -f app.log  # 查看应用日志
```

这个集成指南提供了完整的浏览器历史记录和通话记录功能实现，包括数据提取、API接口、图表生成和前端交互。按照这个指南可以完整地集成这两个功能模块到你的主系统中。
