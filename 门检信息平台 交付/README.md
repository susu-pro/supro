# 信息检索平台

基于 Flask 的 Web 应用，
用于上传、处理、分析和搜索从 JSON 文件中提取的各种数据类型，包括联系人、消息（通用和微信）、通话记录、浏览记录等。
已完成✅：
1、聊天记录tab：搜索关键词及上下文（前500条）、收藏关键词及上下文、显示完整的聊天记录、历史搜索记录
2、通话记录tab：已显示处理好的三张通话记录图，call_log_output.xlsx放至数据导出tab，点击可下载
2、浏览记录tab：仍待开发

## API端点返回JSON格式
```json
{
  "code": 0, // 0 成功
  "message": "描述性信息 (例如: '成功', '错误详情')",
  "timestamp": "ISO 8601 格式的时间戳",
  "data": {},
  // 可选：分页信息
  "pagination": {
      "page": 1,
      "page_size": 50,
      "total": 120,
      "total_pages": 3
   }
}

{
  "wechat_id": "wxid_abcdefg12345",//微信ID 
  "nickname": "微信昵称",         //用户的微信昵称
  "remark": "备注名 (例如: 同事-张三)",//备注名
  "group_name": "技术交流群",      //关联的群聊名称 
  "phone": "13712345678",        //关联的手机号 
  "details": {}
}

{
  "group_id": "1234567890@chatroom", // 微信群ID
  "group_name": "家庭群",            // 微信群名称
  "details": {
    "人数": 5,                     // 群成员数量 
    "群公告": "常回家看看",          // 群公告内容 
    // ... 其他原始提取的详情
  }
}

```
## 数据上传&处理
```json
{
  "status": "started",
  "message": "任务已启动，开始处理 N 个 JSON 文件。",
  "task_id": "唯一的任务UUID"
}
```

### 微信消息格式

```python
{
    'id': str,                # 消息唯一标识符
    'sender': str,            # 发送者名称
    'content': str,           # 消息内容
    'time': str/timestamp,    # 消息时间（字符串或时间戳）
    'is_sent': bool,          # 是否为自己发送的消息
    'source_file': str        # 来源文件名
}
```

### 微信联系人格式

```python
{
    'wechat_id': str,         # 微信ID
    'nickname': str,          # 微信昵称
    'remark': str,            # 备注名
    'group_name': str,        # 所属分组
    'phone': str,             # 关联电话号码
    'details': {              # 详细信息（可能包含多种字段）
        '备注': str,
        '电话': str,
        # 其他可能的字段
    }
}
```

### 微信群组格式

```python
{
    'group_id': str,          # 群组ID
    'group_name': str,        # 群组名称
    'details': {              # 详细信息
        '群公告': str,        # 群公告
        '人数': str/int,      # 群成员数量
        # 其他可能的字段
    }
}
```

## 主要函数

### 提取微信数据

```python
def extract_wechat_data(data, file_path):
    
```

### 提取微信联系人

```python
def extract_wechat_contacts(data):
   
```

### 提取微信群组

```python
def extract_wechat_groups(data):
   
```

### 提取微信消息

```python
def extract_wechat_messages(data, file_path):
    
```

##  API接口示例参见api.py(具体处理逻辑仍参见main.py)
### 集成到Flask应用

```python
from flask import Flask, jsonify
from wechat_data_processor import extract_wechat_data
import json

app = Flask(__name__)

# 全局数据存储
app_data = {
    'wechat_groups': [],
    'wechat_contacts': [],
    'messages': []
}

@app.route('/api/load-wechat-data', methods=['POST'])
def load_wechat_data():
    try:
        with open('uploaded_data.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 提取微信数据
        groups, contacts, messages = extract_wechat_data(data, 'uploaded_data.json')
        
        # 更新全局数据
        app_data['wechat_groups'].extend(groups)
        app_data['wechat_contacts'].extend(contacts)
        app_data['messages'].extend(messages)
        
        return jsonify({
            'status': 'success',
            'groups_count': len(groups),
            'contacts_count': len(contacts),
            'messages_count': len(messages)
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/wechat-groups')
def get_wechat_groups():
    return jsonify(app_data['wechat_groups'])

@app.route('/api/wechat-contacts')
def get_wechat_contacts():
    return jsonify(app_data['wechat_contacts'])

@app.route('/api/wechat-messages')
def get_wechat_messages():
    return jsonify(app_data['messages'])

if __name__ == '__main__':
    app.run(debug=True)
```


### 获取微信群组列表

```
GET /api/wechat-groups
```

**响应格式**:
```json
[
  {
    "group_id": "group123",
    "group_name": "家人群",
    "details": {
      "群公告": "欢迎加入家人群！",
      "人数": "5"
    }
  },
  ...
]
```

### 获取微信联系人列表

```
GET /api/wechat-contacts
```

**响应格式**:
```json
[
  {
    "wechat_id": "wxid_123",
    "nickname": "小明",
    "remark": "同事",
    "group_name": "工作",
    "phone": "13800138000",
    "details": {
      "备注": "同事",
      "电话": "13800138000"
    }
  },
  ...
]
```

### 获取微信消息列表

```
GET /api/wechat-messages
```

**参数**:
- `page`: 页码（默认为1）
- `page_size`: 每页记录数（默认为50）

**响应格式**:
```json
{
  "messages": [
    {
      "id": "msg123",
      "sender": "小明",
      "content": "你好，最近怎么样？",
      "time": "2023-09-15 14:30:25",
      "is_sent": false,
      "source_file": "wechat_backup.json"
    },
    ...
  ],
  "page": 1,
  "page_size": 50,
  "total": 120,
  "total_pages": 3
}
```

### 搜索微信消息

```
GET /api/search
```

**参数**:
- `q`: 搜索关键词
- `type`: 搜索类型（"combined", "sender", "keyword", "semantic"）
- `page`: 页码
- `page_size`: 每页记录数

**响应格式**:
```json
{
  "results": [
    {
      "score": 0.87,
      "data": {
        "type": "message",
        "id": "msg123",
        "sender": "小明",
        "content": "你好，最近怎么样？",
        "time": "2023-09-15 14:30:25",
        "is_sent": false,
        "source_file": "wechat_backup.json",
        "highlighted_content": "你好，最近【怎么样】？"
      },
      "highlight_source": "content"
    },
    ...
  ],
  "page": 1,
  "page_size": 20,
  "total": 45,
  "total_pages": 3,
  "search_type": "combined",
  "query": "怎么样"
}
```