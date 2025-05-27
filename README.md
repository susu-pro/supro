# 聊天记录检索平台

一个基于Flask和JavaScript构建的全栈聊天记录分析与检索系统，支持智能搜索、数据可视化、通话记录分析等功能。


## ✨ 功能特性

### 🔍 智能搜索系统
- **多种搜索模式**：关键词搜索、语义搜索、发送者搜索、综合搜索
- **高级搜索算法**：集成BM25和TF-IDF算法，提供精准的搜索结果
- **中文分词支持**：使用jieba分词库，优化中文文本搜索体验
- **搜索结果高亮**：自动高亮匹配关键词，支持上下文窗口显示
- **搜索历史**：自动保存搜索历史，支持快速重复搜索

### 📊 数据处理与分析
- **批量文件处理**：支持上传多个JSON格式的聊天记录文件
- **智能编码识别**：自动识别UTF-8、GBK、GB18030等多种编码格式
- **实时处理状态**：显示文件处理进度，支持大文件批量处理
- **数据统计概览**：提供聊天记录、联系人、群组等数据统计

### 💬 聊天记录管理
- **多平台支持**：支持微信、通用聊天记录格式
- **对话上下文**：查看消息的前后文对话，理解完整对话流程
- **时间序列浏览**：按时间顺序浏览所有聊天记录
- **分页浏览**：高效的分页机制，支持大量数据浏览

### ⭐ 收藏夹系统
- **一键收藏**：快速收藏重要的搜索结果
- **分类管理**：支持消息、联系人、群组等不同类型的收藏
- **原始搜索关联**：记录收藏时的搜索关键词，支持回溯
- **批量管理**：支持批量添加和删除收藏项

### 📞 通话记录分析
- **通话统计**：分析通话次数、时长、频繁联系人
- **可视化图表**：生成通话分析图表，直观展示通话模式
- **数据导出**：支持Excel格式导出通话记录
- **阈值筛选**：可设定通话次数阈值，筛选重要联系人

### 🎨 用户界面
- **响应式设计**：适配桌面和移动设备
- **现代化UI**：简洁美观的界面设计，良好的用户体验
- **标签页管理**：多功能模块的标签页切换
- **实时反馈**：操作状态的实时反馈和进度显示

## 🛠 技术栈

### 后端技术
- **Web框架**：Flask 
- **数据处理**：pandas, numpy
- **搜索引擎**：scikit-learn (TF-IDF), 自实现BM25算法
- **中文处理**：jieba分词
- **文件处理**：多编码支持，JSON解析
- **并发处理**：threading多线程处理

### 前端技术
- **原生JavaScript**：ES6+语法，模块化设计
- **HTML5/CSS3**：语义化HTML，现代CSS特性
- **响应式设计**：Flexbox, Grid布局
- **图标库**：Font Awesome图标

### 数据存储
- **内存存储**：应用运行时数据缓存
- **文件持久化**：搜索历史和收藏夹数据持久化
- **JSON格式**：标准化的数据交换格式

## 📁 项目结构

```
project/
├── main.py                     # Flask主应用
├── api/
│   └── call_records.py        # 通话记录API
├── static/
│   ├── css/
│   │   └── all.min.css        # Font Awesome样式
│   ├── js/
│   │   ├── main.js            # 主要前端逻辑
│   │   └── enhanced_search.js # 增强搜索功能
│   └── results/               # 结果文件目录
│       ├── excel/             # Excel导出文件
│       └── charts/            # 图表文件
├── templates/
│   └── index.html             # 主页模板
├── uploads/                   # 上传文件临时目录
├── app_data_persistence.json  # 持久化数据文件
└── README.md                  # 项目文档
```

## 🚀 安装部署

### 环境要求
- Python 3.7+
- 8GB+ RAM（推荐，用于处理大文件）
- 100GB+ 磁盘空间


## 📖 使用指南

### 1. 数据准备
准备JSON格式的聊天记录文件，支持的数据结构：

```json
{
  "type": 1,
  "contents": [
    {
      "id": "message_id",
      "user_name": "发送者姓名",
      "content": {
        "text": "消息内容"
      },
      "time": "2023-01-01 12:00:00",
      "position": 1
    }
  ]
}
```

### 2. 上传文件
1. 访问主页，点击上传区域或拖拽文件
2. 选择JSON格式的聊天记录文件
3. 点击"上传并分析"按钮
4. 等待处理完成，查看处理状态

### 3. 搜索功能
1. **关键词搜索**：输入关键词，快速查找相关消息
2. **发送者搜索**：按发送者姓名筛选消息
3. **语义搜索**：基于语义相似度的智能搜索
4. **综合搜索**：结合多种算法的最佳搜索体验

### 4. 高级功能
- **对话上下文**：点击消息的"上下文"按钮查看完整对话
- **收藏管理**：收藏重要搜索结果，便于后续查看
- **数据导出**：导出通话记录为Excel格式
- **统计分析**：查看数据统计概览和可视化图表

## 🔌 API文档

### 文件处理API

#### 开始处理文件
```
POST /api/start-processing
Content-Type: multipart/form-data

files[]: JSON文件列表
```

#### 查询处理状态
```
GET /api/task-status/{task_id}

Response:
{
  "status": "processing|completed|error",
  "progress": 75.5,
  "processed_files": 10,
  "success_files": 8,
  "failed_files": 2
}
```

### 搜索API

#### 搜索内容
```
GET /api/search?q={query}&type={type}&page={page}&page_size={size}

参数:
- q: 搜索关键词
- type: 搜索类型 (combined|keyword|semantic|sender)
- page: 页码
- page_size: 每页条数

Response:
{
  "results": [...],
  "total": 100,
  "page": 1,
  "total_pages": 5
}
```

#### 获取对话上下文
```
GET /api/conversation-context?message_id={id}&context_size={size}

Response:
{
  "context": [
    {
      "id": "msg_id",
      "sender": "发送者",
      "content": "消息内容",
      "time": "时间戳",
      "is_current_message": true
    }
  ]
}
```

### 收藏夹API

#### 添加收藏
```
POST /api/favorites/add
Content-Type: application/json

{
  "type": "message|contact|wechat_group",
  "id": "item_id",
  "query": "搜索词"
}
```

#### 删除收藏
```
POST /api/favorites/remove
Content-Type: application/json

{
  "type": "message",
  "id": "item_id"
}
```

#### 获取收藏列表
```
GET /api/favorites?page={page}&page_size={size}
```

### 数据统计API

#### 获取统计信息
```
GET /api/stats

Response:
{
  "messages_count": 10000,
  "contacts_count": 100,
  "wechat_groups_count": 50,
  "call_records_count": 200
}
```

#### 分析对话数据
```
GET /api/analyze-conversation?q={query}&start_time={start}&end_time={end}

Response:
{
  "total_messages": 1000,
  "sender_stats": {"用户A": 500, "用户B": 300},
  "time_stats": {"2023-01-01": 100},
  "keyword_stats": {"关键词": 50}
}
```

## 👨‍💻 开发说明

### 核心组件

#### 1. 搜索引擎 (EnhancedSearch)
```python
class EnhancedSearch:
    def __init__(self):
        self.bm25_index = None      # BM25索引
        self.tfidf_vectorizer = None # TF-IDF向量化器
        self.tfidf_matrix = None    # TF-IDF矩阵
        
    def combined_search(self, query, top_n=50):
        # 综合搜索，结合BM25和TF-IDF结果
        pass
```

#### 2. 数据处理流程
1. **文件解析**：支持多种编码，处理BOM，清理控制字符
2. **数据提取**：提取消息、联系人、群组、通话记录
3. **索引构建**：建立搜索索引，支持中文分词
4. **结果格式化**：统一的数据格式，支持高亮显示

#### 3. 前端架构
- **模块化设计**：功能分离，便于维护
- **事件驱动**：基于DOM事件的交互逻辑
- **状态管理**：简单的状态管理，保持数据一致性
- **异步处理**：使用Fetch API进行异步数据交互

### 自定义配置

#### 搜索参数调优
```python
# BM25参数
self.k1 = 1.5   # 词频饱和参数
self.b = 0.75   # 文档长度归一化参数

# 搜索结果数量
MAX_SEARCH_RESULTS = 500
```

#### 文件处理配置
```python
# 文件大小限制
MAX_CONTENT_LENGTH = 20 * 1024 * 1024 * 1024  # 20GB

# 批处理大小
BATCH_SIZE = 20

# 搜索历史数量
MAX_SEARCH_HISTORY = 100
```

### 扩展开发

#### 添加新的数据类型
1. 在 `process_file()` 函数中添加提取逻辑
2. 更新 `EnhancedSearch.load_data()` 方法
3. 在前端添加对应的渲染逻辑

#### 添加新的搜索算法
1. 继承或修改 `EnhancedSearch` 类
2. 实现新的搜索方法
3. 在API中集成新算法

## ❓ 常见问题

### Q: 支持哪些聊天记录格式？
A: 主要支持JSON格式的聊天记录，支持微信、通用聊天格式。具体格式请参考"使用指南"中的数据结构说明。

### Q: 文件上传失败怎么办？
A: 
1. 检查文件格式是否为JSON
2. 确认文件编码（支持UTF-8、GBK等）
3. 检查文件大小是否超过20GB限制
4. 查看浏览器控制台错误信息

### Q: 搜索结果不准确？
A: 
1. 尝试不同的搜索类型（关键词/语义/综合）
2. 使用更具体的关键词
3. 检查中文分词是否正确
4. 确认数据是否正确导入

### Q: 如何提高处理性能？
A: 
1. 增加服务器内存
2. 调整批处理大小
3. 使用SSD存储
4. 考虑使用专业数据库

### Q: 数据安全性如何保证？
A: 
1. 所有数据在本地处理，不上传到外部服务器
2. 支持设置访问权限
3. 定期清理临时文件
4. 建议在内网环境部署


**最后更新时间：2025年5月**
