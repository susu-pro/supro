# -*- coding: utf-8 -*-
from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import json
import jieba
import math
import numpy as np
import pandas as pd
from collections import Counter
import uuid
import threading
import shutil
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import re
import datetime
import logging

# --- 导入通话记录 ---
from api.call_records import call_records_bp

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__, template_folder='templates', static_folder='static')

# 大小限制
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024 * 1024 # 20GB

# --- 搜索历史和收藏夹 ---
MAX_SEARCH_HISTORY = 100
FAVORITES_FILE = 'app_data_persistence.json'

# --- 全局数据 ---
app_data = {
    'device_info': {},
    'contacts': [],
    'messages': [],
    'app_summary': [],
    'wechat_groups': [],
    'wechat_contacts': [],
    'call_records': [],
    'search_history': [],
    'favorites': []
}

processing_tasks = {}
search_engine = None

def load_persistent_data():
    """搜索历史和收藏夹"""
    global app_data
    try:
        if os.path.exists(FAVORITES_FILE):
            with open(FAVORITES_FILE, 'r', encoding='utf-8') as f:
                persistent_data = json.load(f)
                app_data['search_history'] = persistent_data.get('search_history', [])
                loaded_favorites = persistent_data.get('favorites', [])
                # 确保收藏项包含类型和ID
                app_data['favorites'] = [
                    fav for fav in loaded_favorites
                    if isinstance(fav, dict) and 'type' in fav and 'id' in fav
                ]
                logging.info(f"从 {FAVORITES_FILE} 加载了 {len(app_data['search_history'])} 条搜索历史和 {len(app_data['favorites'])} 条收藏。")
    except Exception as e:
        logging.error(f"加载持久化数据时出错: {e}", exc_info=True)

def save_persistent_data():
    """保存搜索历史和收藏夹"""
    global app_data
    try:
        # 只保存有效的收藏项
        valid_favorites = [
             fav for fav in app_data.get('favorites', [])
             if isinstance(fav, dict) and 'type' in fav and 'id' in fav
        ]
        data_to_save = {
            'search_history': app_data.get('search_history', []),
            'favorites': valid_favorites
        }
        with open(FAVORITES_FILE, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, ensure_ascii=False, indent=4)
    except Exception as e:
        logging.error(f"保存持久化数据时出错: {e}", exc_info=True)


class BM25:
    # BM25
    def __init__(self, documents):
        self.documents = documents
        self.D = len(documents) 
        self.avgdl = sum([len(doc) for doc in documents]) / self.D if self.D > 0 else 0 
        self.f = []  
        self.df = {} 
        self.idf = {} 
        self.k1 = 1.5 
        self.b = 0.75  
        self._initialize()

    def _initialize(self):
        # 计算词频和文档频率
        for document in self.documents:
            frequencies = Counter(document)
            self.f.append(frequencies)
            for word in frequencies:
                self.df[word] = self.df.get(word, 0) + 1
        # 计算每个词的 IDF
        for word, freq in self.df.items():
            freq = min(freq, self.D) 
            self.idf[word] = math.log((self.D - freq + 0.5) / (freq + 0.5) + 1.0)

    def get_scores(self, query):
        # 计算所有文档的 BM25 分数
        scores = [0] * self.D
        query_freqs = Counter(query) 
        for word, freq in query_freqs.items():
            if word not in self.idf: continue # 忽略不在 IDF 中的词
            for i, doc in enumerate(self.documents):
                if i >= len(self.f) or word not in self.f[i]: continue # 忽略不包含该词的文档
                doc_len = len(doc)
                doc_freq = self.f[i][word] 
                numerator = self.idf[word] * doc_freq * (self.k1 + 1)
                denominator = doc_freq + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                scores[i] += (numerator / denominator) * freq 
        return scores

    def search(self, query, top_n=50):
        # 前 N 个结果
        scores = self.get_scores(query)
        actual_top_n = min(top_n, self.D) #  top_n 不超过文档总数
        top_indices = np.argsort(scores)[::-1][:actual_top_n] 
        return [(i, scores[i]) for i in top_indices if scores[i] > 0]


class EnhancedSearch:
    #  BM25+TF-IDF
    def __init__(self):
        self.message_df = None 
        self.contact_df = None 
        self.bm25_index = None 
        self.tfidf_vectorizer = None 
        self.tfidf_matrix = None 
        self.doc_content = [] 
        self.doc_metadata = []

    def load_data(self, messages, contacts, wechat_groups, wechat_contacts):
        # 消息 DataFrame
        if messages:
            self.message_df = pd.DataFrame(messages)
            if 'time' in self.message_df.columns:
                def parse_datetime(time_str):
                    if isinstance(time_str, (int, float)):
                        try: return pd.to_datetime(time_str, unit='s')
                        except: return pd.NaT
                    elif isinstance(time_str, str):
                        try: return pd.to_datetime(time_str) # 尝试直接解析
                        except ValueError:
                            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S'):
                                try: return datetime.datetime.strptime(time_str, fmt)
                                except ValueError: pass
                            return pd.NaT 
                    return pd.NaT 
                self.message_df['time'] = self.message_df['time'].apply(parse_datetime)
                self.message_df = self.message_df.dropna(subset=['time']) # 删除无法解析时间的行
        else:
            # 即使没有消息，DataFrame 也存在
            self.message_df = pd.DataFrame(columns=['id', 'sender', 'content', 'time', 'is_sent', 'source_file'])

        # 联系人 DataFrame
        if contacts:
            contact_data = []
            for contact in contacts:
                flat_contact = {'id': contact.get('id', ''), 'name': contact.get('name', '')}
                if isinstance(contact.get('details'), dict):
                    flat_contact.update(contact['details']) # 合并详细信息
                contact_data.append(flat_contact)
            self.contact_df = pd.DataFrame(contact_data)
        else:
            # 即使没有联系人，DataFrame 也存在
            self.contact_df = pd.DataFrame(columns=['id', 'name'])

        # 搜索索引
        self._create_search_index(messages, contacts, wechat_groups, wechat_contacts)

    def _create_search_index(self, messages, contacts, wechat_groups, wechat_contacts):
        # BM25+TF-IDF 索引
        self.doc_content = []
        self.doc_metadata = []

        def add_doc(text, metadata):
            # 添加文档到索引
            text = str(text) if text is not None else '' 
            words = [word for word in jieba.cut(text) if word.strip()] 
            self.doc_content.append(' '.join(words)) 
            metadata['original_text'] = text 
            self.doc_metadata.append(metadata)

        # 添加消息数据
        for msg in messages or []:
            add_doc(f"{msg.get('sender', '')} {msg.get('content', '')}", {
                'type': 'message', 'id': msg.get('id', ''), 'sender': msg.get('sender', ''),
                'content': msg.get('content', ''), 'time': str(msg.get('time', '')),
                'source': msg.get('source_file', ''), 'is_sent': msg.get('is_sent', False)
            })

        # 添加联系人数据
        for contact in contacts or []:
             phone = contact.get('details', {}).get('电话号码', '')
             add_doc(f"{contact.get('name', '')} {phone}", {
                 'type': 'contact', 'id': contact.get('id', ''), 'name': contact.get('name', ''), 'phone': phone
             })

        # 添加微信群组数据
        for group in wechat_groups or []:
             announcement = group.get('details', {}).get('群公告', '')
             add_doc(f"{group.get('group_name', '')} {announcement}", {
                 'type': 'wechat_group', 'id': group.get('group_id', ''), 'group_name': group.get('group_name', ''),
                 'announcement': announcement, 'member_count': group.get('details', {}).get('人数', '')
             })

        # 添加微信联系人数据
        for contact in wechat_contacts or []:
             add_doc(f"{contact.get('nickname', '')} {contact.get('remark', '')} {contact.get('group_name', '')}", {
                 'type': 'wechat_contact', 'id': contact.get('wechat_id', ''), 'nickname': contact.get('nickname', ''),
                 'remark': contact.get('remark', ''), 'group_name': contact.get('group_name', ''), 'phone': contact.get('phone', '')
             })

        # 仅当有内容时才添加索引
        if self.doc_content:
            tokenized_docs = [doc.split() for doc in self.doc_content]
            self.bm25_index = BM25(tokenized_docs)
            self.tfidf_vectorizer = TfidfVectorizer(analyzer='word', token_pattern=r'\S+')
            self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(self.doc_content)
        else:
            # if没有内容，重置索引
            self.bm25_index = None
            self.tfidf_vectorizer = None
            self.tfidf_matrix = None

    def keyword_search(self, query, top_n=50):
        # BM25关键字搜索
        if not self.bm25_index or not query:
            return []
        query_tokens = [word for word in jieba.cut(query) if word.strip()] 
        results = self.bm25_index.search(query_tokens, top_n=top_n)
        # 确保索引有效
        return [dict(self.doc_metadata[idx], score=score, match_type='keyword')
                for idx, score in results if idx < len(self.doc_metadata)]

    def semantic_search(self, query, top_n=50):
        # TF-IDF 和余弦相似度进行语义搜索
        if not self.tfidf_vectorizer or not self.tfidf_matrix is not None or not query:
            return []
        query_tokens = ' '.join([word for word in jieba.cut(query) if word.strip()]) 
        query_vector = self.tfidf_vectorizer.transform([query_tokens])
        cosine_similarities = cosine_similarity(query_vector, self.tfidf_matrix).flatten()
        actual_top_n = min(top_n, self.tfidf_matrix.shape[0]) 
        top_indices = np.argsort(cosine_similarities)[::-1][:actual_top_n] 
        # 索引有效且分数大于 0
        return [dict(self.doc_metadata[idx], score=float(cosine_similarities[idx]), match_type='semantic')
                for idx in top_indices if cosine_similarities[idx] > 0 and idx < len(self.doc_metadata)]

    def combined_search(self, query, top_n=50):
        # 结合关键字搜索和语义搜索的结果
        keyword_results = self.keyword_search(query, top_n=top_n * 2)
        semantic_results = self.semantic_search(query, top_n=top_n * 2) 

        result_dict = {}
        def get_result_key(res):
            res_type = res.get('type', 'unknown')
            res_id = res.get('id', 'no_id')
            return f"{res_type}_{res_id}"

        # 处理结果，优先保留分数更高的结果
        for result in keyword_results + semantic_results:
             if isinstance(result, dict): 
                 result_key = get_result_key(result)
                 current_score = result.get('score', 0)
                 if result_key not in result_dict or current_score > result_dict[result_key].get('score', 0):
                    result_dict[result_key] = result

        # 排序
        combined_results = sorted(result_dict.values(), key=lambda x: x.get('score', 0), reverse=True)

        return combined_results[:top_n]

    def highlight_matches(self, text, query, window_size=20):
        # 高亮+上下文窗口
        if not text or not query:
            return str(text) if text is not None else ''
        text = str(text) 

        query_tokens = [word for word in jieba.cut(query) if word.strip()] 
        matches = []
        for token in query_tokens:
            start = 0
            while True:
                pos = text.find(token, start)
                if pos == -1:
                    break # 未找到则退出循环
                matches.append((pos, pos + len(token)))
                start = pos + 1 

        if not matches:
            return text # 没有匹配项则返回原文本

        matches.sort(key=lambda x: x[0])

        # 合并重叠或相邻的匹配项
        merged_matches = []
        if matches:
            current_start, current_end = matches[0]
            for start, end in matches[1:]:
                if start <= current_end:
                    current_end = max(current_end, end)
                else:
                    merged_matches.append((current_start, current_end))
                    current_start, current_end = start, end
            # 添加最后一个合并项
            merged_matches.append((current_start, current_end))

        # 带上下文的高亮字符串
        highlighted = ""
        last_end = 0
        for start, end in merged_matches:
            context_start = max(0, start - window_size)
            prefix = "... " if context_start > last_end else ""
            highlighted += prefix + text[max(last_end, context_start):start]
            highlighted += f"【{text[start:end]}】"
            last_end = end


        context_end = min(len(text), last_end + window_size)
        # 上下文窗口未到达文本末尾，添加后缀省略号
        suffix = " ..." if context_end < len(text) else ""
        highlighted += text[last_end:context_end] + suffix

        return highlighted

    def search_by_sender(self, sender_name, top_n=50):
        # 按发件人姓名搜索消息
        if self.message_df is None or self.message_df.empty or 'sender' not in self.message_df.columns:
            return []

        sender_series = self.message_df['sender'].astype(str).fillna('')

        # 不区分大小写的搜索
        matched_messages = self.message_df[sender_series.str.contains(sender_name, na=False, case=False)]

        # 前 N 个结果
        results = matched_messages.head(top_n).to_dict('records')

        # 格式化结果以与其他搜索方法保持一致
        search_results = []
        for msg in results:
            search_results.append({
                'type': 'message',
                'id': msg.get('id', ''),
                'sender': msg.get('sender', ''),
                'content': msg.get('content', ''),
                'time': str(msg.get('time', '')), # 将时间转换为字符串
                'source': msg.get('source_file', ''),
                'score': 1.0, 
                'match_type': 'sender',
                'original_text': f"{msg.get('sender', '')} {msg.get('content', '')}", 
                'is_sent': msg.get('is_sent', False)
            })
        return search_results

    def find_conversation_context(self, message_id, window_size=3):
         # 查找上下文对话
         if self.message_df is None or self.message_df.empty or 'id' not in self.message_df.columns or 'source_file' not in self.message_df.columns or 'time' not in self.message_df.columns:
             logging.warning("消息 DataFrame 缺少用于上下文搜索的必要列 ('id', 'source_file', 'time')。")
             return []

         try:
             current_message_series = self.message_df[self.message_df['id'] == message_id]
             if current_message_series.empty:
                 logging.warning(f"上下文搜索：未找到消息 ID {message_id}。")
                 return []
             current_message = current_message_series.iloc[0]
             source_file = current_message['source_file']
             current_message_time = current_message['time']

             # 过滤来自相同源文件的消息
             same_source_df = self.message_df[self.message_df['source_file'] == source_file].copy()

             #  'time' 列是 datetime 
             if not pd.api.types.is_datetime64_any_dtype(same_source_df['time']):
                 same_source_df['time'] = pd.to_datetime(same_source_df['time'], errors='coerce')
                 same_source_df = same_source_df.dropna(subset=['time']) 

             # 按时间排序
             same_source_df = same_source_df.sort_values(by='time')

             # 在排序后的 DataFrame 中查找当前消息的索引
             try:
                  message_row = same_source_df.loc[current_message.name]
                  sorted_idx = same_source_df.index.get_loc(current_message.name)
             except KeyError:
                  exact_match = same_source_df[(same_source_df['id'] == message_id) & (same_source_df['time'] == current_message_time)]
                  if not exact_match.empty:
                      sorted_idx = same_source_df.index.get_loc(exact_match.index[0])
                  else:
                      logging.warning(f"上下文搜索：排序后无法可靠地定位消息 {message_id}。")
                      return []

             # 计算上下文窗口的索引
             start_idx = max(0, sorted_idx - window_size)
             end_idx = min(len(same_source_df), sorted_idx + window_size + 1) # +1 以包含结束索引

             # 上下文消息
             context_df = same_source_df.iloc[start_idx:end_idx]

             context_messages = context_df.to_dict('records')

             # 格式化时间
             for msg in context_messages:
                 msg['time'] = str(msg['time']) if pd.notna(msg['time']) else None
                 msg['is_current_message'] = (msg.get('id') == message_id) # 标记原始消息

             return context_messages
         except Exception as e:
             logging.error(f"查找消息 {message_id} 的上下文时出错：{e}", exc_info=True)
             return []

    def analyze_conversation(self, query=None, time_range=None):
        # 分析对话数据（统计信息）
        if self.message_df is None or self.message_df.empty:
            return {'total_messages': 0, 'sender_stats': {}, 'time_stats': {}, 'keyword_stats': {}}

        filtered_df = self.message_df.copy()

        if 'content' in filtered_df.columns:
            filtered_df['content'] = filtered_df['content'].astype(str).fillna('')
        else:
            filtered_df['content'] = ''

        # 关键字过滤
        if query:
            query_tokens = [word for word in jieba.cut(query) if word.strip()]
            if query_tokens:
                pattern = '|'.join(map(re.escape, query_tokens))
                mask = filtered_df['content'].str.contains(pattern, na=False, case=False)
                filtered_df = filtered_df[mask]

        # 时间范围过滤
        if time_range and len(time_range) == 2:
            start_str, end_str = time_range
            #  'time' 列
            if 'time' in filtered_df.columns:
                if not pd.api.types.is_datetime64_any_dtype(filtered_df['time']):
                    filtered_df['time'] = pd.to_datetime(filtered_df['time'], errors='coerce')
                    filtered_df = filtered_df.dropna(subset=['time'])

                # 仅当 'time' 列现在是 datetime 类型时才继续
                if pd.api.types.is_datetime64_any_dtype(filtered_df['time']):
                    try:
                        start_dt = pd.to_datetime(start_str, errors='coerce') if start_str else None
                        end_dt = pd.to_datetime(end_str, errors='coerce') if end_str else None

                        if pd.notna(start_dt) and pd.notna(end_dt):
                            filtered_df = filtered_df[(filtered_df['time'] >= start_dt) & (filtered_df['time'] <= end_dt)]
                        elif pd.notna(start_dt):
                            filtered_df = filtered_df[filtered_df['time'] >= start_dt]
                        elif pd.notna(end_dt):
                            filtered_df = filtered_df[filtered_df['time'] <= end_dt]
                    except Exception as e: 
                        logging.warning(f"分析的时间格式无效 ('{start_str}', '{end_str}'): {e}，跳过时间过滤器。")
                else:
                    logging.warning("无法将 'time' 列转换为 datetime 以进行分析过滤。")
            else:
                 logging.warning("缺少用于分析过滤的 'time' 列。")

        # 过滤后没有数据，则返回空统计信息
        if filtered_df.empty:
            return {'total_messages': 0, 'sender_stats': {}, 'time_stats': {}, 'keyword_stats': {}}

        # 计算统计数据
        total_messages = len(filtered_df)

        # 发件人统计
        sender_stats = {}
        if 'sender' in filtered_df.columns:
            sender_stats = filtered_df['sender'].astype(str).fillna('Unknown').value_counts().to_dict()

        # 时间统计
        time_stats = {}
        if 'time' in filtered_df.columns and pd.api.types.is_datetime64_any_dtype(filtered_df['time']):
            filtered_df['date'] = filtered_df['time'].dt.date
            time_stats = {str(k): int(v) for k, v in filtered_df['date'].value_counts().sort_index().to_dict()}

        # 关键字统计
        keyword_stats = {}
        if 'content' in filtered_df.columns:
            all_words = []
            for content in filtered_df['content'].dropna():
                words = [word for word in jieba.cut(str(content)) if word.strip() and len(word) > 1]
                all_words.extend(words)
            keyword_stats = {k: int(v) for k, v in Counter(all_words).most_common(50)}

        return {
            'total_messages': total_messages,
            'sender_stats': sender_stats,
            'time_stats': time_stats,
            'keyword_stats': keyword_stats
        }

# --- 数据提取函数 ---
def load_json_file(file_path):
    try:
        with open(file_path, 'rb') as f:
            raw_content = f.read()
        if not raw_content:
            logging.warning(f"文件 {file_path} 为空。")
            return None
        # 处理 BOM
        if raw_content.startswith(b'\xef\xbb\xbf'):
            raw_content = raw_content[3:]

        content = None
        # 常用编码解码
        for encoding in ['utf-8', 'utf-16', 'gbk', 'gb18030', 'latin-1']:
            try:
                content = raw_content.decode(encoding)
                content = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', content)
                break
            except UnicodeDecodeError:
                continue 

        # 所有常用编码都失败，尝试使用 utf-8 并替换错误
        if content is None:
            logging.warning(f"无法使用常用编码解码文件 {file_path}，尝试 utf-8 replace。")
            content = raw_content.decode('utf-8', errors='replace')
            content = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', content)

        content = content.strip()

        if content.startswith('var page = '):
            content = content[len('var page = '):]
        elif content.startswith(';static.mypico.json.'):
            prefix_end = content.find('=')
            if prefix_end > 0:
                content = content[prefix_end+1:].strip()

        
        if content.endswith(';'):
            content = content[:-1].strip()

        # 将清理后的内容解析为 JSON
        return json.loads(content)

    except json.JSONDecodeError as json_err:
         logging.error(f"文件 {file_path} 中的 JSON 解析错误：{json_err} 在行 {json_err.lineno} 列 {json_err.colno}")
         return None 
    except Exception as e:
        # log其他异常
        logging.error(f"加载/解析文件 {file_path} 时出错：{e}", exc_info=True)
        return None

def extract_messages(data, file_path):
    messages = []
    file_basename = os.path.basename(file_path) 

    def add_message(msg_dict):
        content_data = msg_dict.get('content')
        text_content = None
        if isinstance(content_data, dict):
            text_content = content_data.get('text')
        elif isinstance(content_data, str):
            text_content = content_data 

        # 仅在找到文本内容时添加消息
        if text_content is not None:
            messages.append({
                'id': msg_dict.get('id', str(uuid.uuid4())),
                'sender': msg_dict.get('user_name', 'Unknown'), 
                'content': text_content,
                'time': msg_dict.get('time', None), 
                'is_sent': msg_dict.get('position', 0) == 1,
                'source_file': file_basename 
            })

    # 处理数据结构
    if isinstance(data, dict) and data.get('type') == 1 and isinstance(data.get('contents'), list):
        for msg in data['contents']:
            if isinstance(msg, dict): 
                add_message(msg)
    elif isinstance(data, dict) and data.get('page') and isinstance(data['page'], dict):
        messages.extend(extract_messages(data['page'], file_path))
    elif isinstance(data, list):
         # 处理顶层是消息列表的情况
         for item in data:
             if isinstance(item, dict) and 'content' in item: 
                 add_message(item)
    return messages

def extract_device_info(data):
    # 提取设备信息
    device_info = {}
    if isinstance(data, dict) and data.get('type') == 0:
        contents_data = data.get('contents')
        if isinstance(contents_data, dict):
            actual_contents = contents_data.get('contents')
            if isinstance(actual_contents, list):
                for item in actual_contents:
                    if isinstance(item, list) and len(item) >= 3:
                        key_part, value_part = item[1], item[2]
                        if isinstance(key_part, list) and len(key_part) > 1 and isinstance(key_part[1], str):
                            key = key_part[1]
                            value = None
                            if isinstance(value_part, list) and len(value_part) > 1:
                                value = value_part[1]
                            elif len(value_part) == 1 and isinstance(value_part[0], str):
                                value = value_part[0]
                            if value is not None:
                                device_info[key] = value
    return device_info

def extract_contacts(data):
    # 提取联系人
    contacts = []
    is_contact_data = False
    if isinstance(data, dict) and isinstance(data.get('parents'), list):
        for parent in data['parents']:
             if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
                any(keyword in parent[0].lower() for keyword in ['通讯录', '联系人', 'contact']):
                 is_contact_data = True
                 break
    # 识别联系人数据，提取详细信息
    if is_contact_data and isinstance(data.get('contents'), dict):
        actual_contents = data['contents'].get('contents')
        if isinstance(actual_contents, list):
            for contact_entry in actual_contents:
                if isinstance(contact_entry, list) and len(contact_entry) >= 2:
                    contact_data = {
                        'id': contact_entry[0][1] if len(contact_entry[0]) > 1 else str(uuid.uuid4()),
                        'name': contact_entry[1][1] if len(contact_entry[1]) > 1 else 'Unknown',
                        'details': {}
                    }
                    if len(contact_entry) > 2 and isinstance(contact_entry[2], list) and len(contact_entry[2]) > 0:
                        details_list = contact_entry[2][0]
                        if isinstance(details_list, list):
                            for detail_item in details_list:
                                if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                    contact_data['details'][detail_item[0]] = detail_item[1]
                    contacts.append(contact_data)
    return contacts

def extract_app_summary(data):
    # 提取应用摘要信息
    app_summary = []
    is_app_data = False
    if isinstance(data, dict) and isinstance(data.get('parents'), list):
         for parent in data['parents']:
             if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
                any(keyword in parent[0].lower() for keyword in ['应用', 'app', '摘要', 'summary']):
                 is_app_data = True
                 break
    if is_app_data and isinstance(data.get('contents'), dict):
        actual_contents = data['contents'].get('contents')
        if isinstance(actual_contents, list):
            for app_entry in actual_contents:
                if isinstance(app_entry, list) and len(app_entry) >= 2:
                    app_data_item = {
                        'id': app_entry[0][1] if len(app_entry[0]) > 1 else str(uuid.uuid4()),
                        'name': app_entry[1][1] if len(app_entry[1]) > 1 else 'Unknown',
                        'details': {}
                    }
                    if len(app_entry) > 2 and isinstance(app_entry[2], list) and len(app_entry[2]) > 0:
                        details_list = app_entry[2][0]
                        if isinstance(details_list, list):
                            for detail_item in details_list:
                                if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                    app_data_item['details'][detail_item[0]] = detail_item[1]
                    app_summary.append(app_data_item)
    return app_summary

def extract_wechat_data(data, file_path):
    # 提取微信群组、联系人、消息
    groups, contacts, messages = [], [], []
    file_basename = os.path.basename(file_path)
    is_wechat = False
    if isinstance(data, dict) and isinstance(data.get('parents'), list):
        for parent in data['parents']:
            if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
               any(kw in parent[0].lower() for kw in ['微信', 'wechat', 'weixin']):
                is_wechat = True
                break
    if not is_wechat:
        return groups, contacts, messages

    # 提取消息
    if data.get('type') == 1:
        messages.extend(extract_messages(data, file_path))

    # 提取群组
    is_group_data = False
    if isinstance(data.get('parents'), list):
        for parent in data['parents']:
            if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
               any(kw in parent[0].lower() for kw in ['群组', 'group']):
                is_group_data = True
                break
    if is_group_data and isinstance(data.get('contents'), dict):
        actual_contents = data['contents'].get('contents')
        if isinstance(actual_contents, list):
            for group_entry in actual_contents:
                if isinstance(group_entry, list) and len(group_entry) >= 2:
                    group_data = {
                        'group_id': group_entry[0][1] if len(group_entry[0]) > 1 else str(uuid.uuid4()),
                        'group_name': group_entry[1][1] if len(group_entry[1]) > 1 else 'Unknown Group',
                        'details': {}
                    }
                    if len(group_entry) > 2 and isinstance(group_entry[2], list) and len(group_entry[2]) > 0:
                        details_list = group_entry[2][0]
                        if isinstance(details_list, list):
                            for detail_item in details_list:
                                if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                    group_data['details'][detail_item[0]] = detail_item[1]
                    groups.append(group_data)

    # 提取微信联系人
    is_wechat_contact_data = False
    if is_wechat and isinstance(data.get('parents'), list):
         for parent in data['parents']:
             if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
                any(kw in parent[0].lower() for kw in ['联系人', 'contact']) and '通讯录' not in parent[0]: 
                 is_wechat_contact_data = True
                 break
    if is_wechat_contact_data and isinstance(data.get('contents'), dict):
        actual_contents = data['contents'].get('contents')
        if isinstance(actual_contents, list):
             for contact_entry in actual_contents:
                 if isinstance(contact_entry, list) and len(contact_entry) >= 2:
                     wx_contact = {
                         'wechat_id': contact_entry[0][1] if len(contact_entry[0]) > 1 else str(uuid.uuid4()),
                         'nickname': contact_entry[1][1] if len(contact_entry[1]) > 1 else 'Unknown',
                         'remark': '', 'group_name': '', 'phone': '', 'details': {}
                     }
                     if len(contact_entry) > 2 and isinstance(contact_entry[2], list) and len(contact_entry[2]) > 0:
                         details_list = contact_entry[2][0]
                         if isinstance(details_list, list):
                             for detail_item in details_list:
                                 if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                     key, value = detail_item[0], detail_item[1]
                                     wx_contact['details'][key] = value
                                     if '备注' in key or 'remark' in key.lower(): wx_contact['remark'] = value
                                     if '群' in key or 'group' in key.lower(): wx_contact['group_name'] = value
                                     if '电话' in key or 'phone' in key.lower(): wx_contact['phone'] = value
                     contacts.append(wx_contact)

    return groups, contacts, messages


# --- 文件处理逻辑 ---
def process_file(file_path):
    data = load_json_file(file_path)
    if not data:
        logging.warning(f"文件 {os.path.basename(file_path)} 加载失败或为空，跳过。")
        return None, None, None, None, None, None, None

    device_info = extract_device_info(data)
    contacts = extract_contacts(data)
    messages = extract_messages(data, file_path)
    app_summary = extract_app_summary(data)
    wechat_groups, wechat_contacts, wechat_messages = extract_wechat_data(data, file_path)

    # --- 提取通话记录 ---
    call_records = []
    is_call_log_data = False
    if isinstance(data, dict) and isinstance(data.get('parents'), list):
        for parent in data['parents']:
             if isinstance(parent, list) and len(parent) > 0 and isinstance(parent[0], str) and \
                any(keyword in parent[0].lower() for keyword in ['通话记录', 'call log', 'call record']):
                 is_call_log_data = True
                 break
    if is_call_log_data and isinstance(data.get('contents'), dict):
         actual_contents = data['contents'].get('contents')
         if isinstance(actual_contents, list):
              for call_entry in actual_contents:
                   # 假设通话记录条目结构为 [id_info, number_info, details_info]
                   if isinstance(call_entry, list) and len(call_entry) >= 3:
                        call_data = {
                            'id': call_entry[0][1] if len(call_entry[0]) > 1 else str(uuid.uuid4()),
                            'phone': call_entry[1][1] if len(call_entry[1]) > 1 else 'Unknown',
                            'details': {}
                        }
                        if len(call_entry) > 2 and isinstance(call_entry[2], list) and len(call_entry[2]) > 0:
                             details_list = call_entry[2][0]
                             if isinstance(details_list, list):
                                 for detail_item in details_list:
                                      if isinstance(detail_item, list) and len(detail_item) >= 2 and isinstance(detail_item[0], str):
                                          key, value = detail_item[0], detail_item[1]
                                          call_data['details'][key] = value
                                          
                                          if '时长' in key or 'duration' in key.lower(): call_data['duration'] = value
                                          if '时间' in key or 'time' in key.lower(): call_data['time'] = value
                                          if '类型' in key or 'type' in key.lower(): call_data['call_type'] = value 
                                          if '删除' in key or 'delete' in key.lower(): call_data['is_deleted'] = value
                        call_records.append(call_data)

    # 合并消息 (去重)
    existing_message_ids = {msg['id'] for msg in messages if 'id' in msg}
    for wx_msg in wechat_messages:
        if 'id' in wx_msg and wx_msg['id'] not in existing_message_ids:
            messages.append(wx_msg)
            existing_message_ids.add(wx_msg['id'])

    return device_info, contacts, messages, app_summary, wechat_groups, wechat_contacts, call_records

def process_batch_files(file_paths, task_id=None):
    """处理文件并合并数据"""
    batch_data = {'device_info': {}, 'contacts': [], 'messages': [], 'app_summary': [],
                  'wechat_groups': [], 'wechat_contacts': [], 'call_records': []}
    processed, success, failed = 0, 0, 0
    total = len(file_paths)

    for file_path in file_paths:
        processed += 1
        logging.info(f"[任务 {task_id or 'N/A'}] 处理文件 {processed}/{total}: {os.path.basename(file_path)}")
        try:
            results = process_file(file_path)
            if any(res is not None for res in results):
                success += 1
                if isinstance(results[0], dict): batch_data['device_info'].update(results[0])
                if isinstance(results[1], list): batch_data['contacts'].extend(results[1])
                if isinstance(results[2], list): batch_data['messages'].extend(results[2])
                if isinstance(results[3], list): batch_data['app_summary'].extend(results[3])
                if isinstance(results[4], list): batch_data['wechat_groups'].extend(results[4])
                if isinstance(results[5], list): batch_data['wechat_contacts'].extend(results[5])
                if isinstance(results[6], list): batch_data['call_records'].extend(results[6]) 
            else:
                failed += 1
        except Exception as e:
            failed += 1
            logging.error(f"[任务 {task_id or 'N/A'}] 处理文件 {os.path.basename(file_path)} 时出错：{e}", exc_info=True)

        # 更新任务状态
        if task_id and task_id in processing_tasks:
            processing_tasks[task_id]['processed_files'] = processed
            # 成功/失败计数
            processing_tasks[task_id]['success_files'] += (1 if results and any(res is not None for res in results) else 0)
            processing_tasks[task_id]['failed_files'] += (1 if not results or all(res is None for res in results) else 0)

    logging.info(f"[任务 {task_id or 'N/A'}] 批处理完成。成功: {success}, 失败: {failed}")
    return batch_data, success, failed

def process_files_async(task_id, file_paths, batch_size=20):
    """异步处理文件，分批进行"""
    global app_data, search_engine
    try:
        total_files = len(file_paths)
        total_batches = (total_files + batch_size - 1) // batch_size
        total_success, total_failed = 0, 0

        # 初始化/清空应用数据，但保留历史和收藏
        current_history = app_data.get('search_history', [])
        current_favorites = app_data.get('favorites', [])
        app_data = {
            'device_info': {}, 'contacts': [], 'messages': [], 'app_summary': [],
            'wechat_groups': [], 'wechat_contacts': [], 'call_records': [],
            'search_history': current_history, 'favorites': current_favorites
        }

        logging.info(f"任务 {task_id}: 开始处理 {total_files} 个文件，共 {total_batches} 批。")

        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min((batch_num + 1) * batch_size, total_files)
            batch_files = file_paths[start_idx:end_idx]
            logging.info(f"任务 {task_id}: 处理批次 {batch_num + 1}/{total_batches} (文件 {start_idx + 1}-{end_idx})。")

            if task_id in processing_tasks:
                processing_tasks[task_id].update({
                    'status': 'processing_batch',
                    'current_batch': batch_num + 1,
                    'total_batches': total_batches
                })

            try:
                batch_data, success, failed = process_batch_files(batch_files, task_id)
                total_success += success
                total_failed += failed

                # 合并数据到全局 app_data
                app_data['device_info'].update(batch_data['device_info'])
                app_data['contacts'].extend(batch_data['contacts'])
                app_data['messages'].extend(batch_data['messages'])
                app_data['app_summary'].extend(batch_data['app_summary'])
                app_data['wechat_groups'].extend(batch_data['wechat_groups'])
                app_data['wechat_contacts'].extend(batch_data['wechat_contacts'])
                app_data['call_records'].extend(batch_data['call_records'])

                logging.info(f"任务 {task_id}: 批次 {batch_num + 1} 完成。成功: {success}, 失败: {failed}。累计: {total_success}/{total_failed}")

                # 更新总体任务状态
                if task_id in processing_tasks:
                     processing_tasks[task_id]['success_files'] = total_success
                     processing_tasks[task_id]['failed_files'] = total_failed

            except Exception as batch_e:
                logging.error(f"任务 {task_id}: 处理批次 {batch_num + 1} 时出现严重错误：{batch_e}", exc_info=True)
                failed_in_batch = len(batch_files)
                total_failed += failed_in_batch
                if task_id in processing_tasks:
                    task = processing_tasks[task_id]
                    task['batch_errors'] = task.get('batch_errors', []) + [f"批次 {batch_num + 1} 错误: {str(batch_e)}"]
                    task['failed_files'] = total_failed
                    task['processed_files'] = task.get('processed_files', 0) + failed_in_batch

        logging.info(f"任务 {task_id}: 所有批次处理完毕。总成功: {total_success}, 失败: {total_failed}。正在加载数据...")

        # --- 初始化搜索引擎 ---
        global search_engine
        search_engine = EnhancedSearch() 
        search_engine.load_data(
            app_data['messages'], app_data['contacts'],
            app_data['wechat_groups'], app_data['wechat_contacts']
        )
        logging.info(f"任务 {task_id}: 数据已加载到搜索引擎。")

        if task_id in processing_tasks:
            processing_tasks[task_id].update({
                'status': 'completed',
                'success_files': total_success,
                'failed_files': total_failed,
                'processed_files': total_files 
            })

        # 清理上传目录
        upload_dir = os.path.join('uploads', f'task_{task_id}')
        if os.path.exists(upload_dir):
             try:
                 shutil.rmtree(upload_dir)
                 logging.info(f"任务 {task_id}: 已清理上传目录 {upload_dir}")
             except Exception as clean_e:
                 logging.error(f"任务 {task_id}: 清理上传目录 {upload_dir} 时出错：{clean_e}")

    except Exception as e:
        logging.error(f"任务 {task_id}: 处理过程中出现严重错误：{e}", exc_info=True)
        if task_id in processing_tasks:
            processing_tasks[task_id].update({
                'status': 'error',
                'error': str(e)
            })


# --- Flask 路由 ---
# --- 注册蓝图 ---
# call_records_bp 注册+设置 URL 前缀
app.register_blueprint(call_records_bp, url_prefix='/api/call-records')


@app.route('/')
def index():
    global search_engine
    if search_engine is None:
        search_engine = EnhancedSearch()
        logging.info("搜索引擎在首次请求时初始化。")
    return render_template('index.html') 

@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)


@app.route('/api/start-processing', methods=['POST'])
def start_processing():
    # 文件处理
    if 'files[]' not in request.files:
        return jsonify({'status': 'error', 'message': '没有上传文件'}), 400
    files = request.files.getlist('files[]')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'status': 'error', 'message': '没有选择文件或文件无效'}), 400

    json_files = [f for f in files if f.filename and f.filename.lower().endswith('.json')]
    if not json_files:
         return jsonify({'status': 'error', 'message': '未找到有效的 JSON 文件'}), 400

    task_id = str(uuid.uuid4())
    upload_dir = os.path.join('uploads', f'task_{task_id}')
    try:
        os.makedirs(upload_dir, exist_ok=True)
    except OSError as e:
         logging.error(f"无法创建上传目录 {upload_dir}: {e}")
         return jsonify({'status': 'error', 'message': '无法创建上传目录'}), 500

    file_paths = []
    for file in json_files:
        filename = os.path.basename(file.filename)
        if not filename: continue
        file_path = os.path.join(upload_dir, filename)
        try:
            file.save(file_path)
            file_paths.append(file_path)
        except Exception as e:
            logging.error(f"保存文件失败 {filename}: {e}")

    if not file_paths:
        return jsonify({'status': 'error', 'message': '所有文件保存失败'}), 500

    # 初始化任务状态
    processing_tasks[task_id] = {
        'status': 'queued', 'task_id': task_id, 'total_files': len(file_paths),
        'processed_files': 0, 'success_files': 0, 'failed_files': 0,
        'current_batch': 0, 'total_batches': 0,
        'start_time': datetime.datetime.now().isoformat()
    }

    # 后台线程处理
    thread = threading.Thread(target=process_files_async, args=(task_id, file_paths))
    thread.daemon = True
    thread.start()
    logging.info(f"任务 {task_id}: 为 {len(file_paths)} 个文件启动了后台线程。")
    return jsonify({'status': 'started', 'message': f'任务已启动，开始处理 {len(file_paths)} 个 JSON 文件。', 'task_id': task_id })

@app.route('/api/task-status/<task_id>', methods=['GET'])
def get_task_status(task_id):
    # 文件处理状态
    if task_id not in processing_tasks:
        return jsonify({'status': 'error', 'message': '任务不存在或已过期'}), 404
    task = processing_tasks[task_id]
    progress = 0
    # 进度百分比
    if task.get('total_files', 0) > 0:
         progress = (task.get('processed_files', 0) / task['total_files']) * 100
         if task.get('status') == 'completed': progress = 100

    # 响应数据
    response = {
        'task_id': task_id, 'status': task['status'], 'total_files': task['total_files'],
        'processed_files': task.get('processed_files', 0),
        'success_files': task.get('success_files', 0),
        'failed_files': task.get('failed_files', 0),
        'current_batch': task.get('current_batch', 0),
        'total_batches': task.get('total_batches', 0),
        'progress': round(progress, 2),
        'error': task.get('error', ''),
        'batch_errors': task.get('batch_errors', []),
        'start_time': task.get('start_time', None)
    }
    return jsonify(response)

# --- 数据检索 API ---
@app.route('/api/device-info')
def get_device_info(): return jsonify(app_data.get('device_info', {}))
@app.route('/api/contacts')
def get_contacts(): return jsonify(app_data.get('contacts', []))
@app.route('/api/wechat-contacts')
def get_wechat_contacts(): return jsonify(app_data.get('wechat_contacts', []))
@app.route('/api/wechat-groups')
def get_wechat_groups(): return jsonify(app_data.get('wechat_groups', []))
@app.route('/api/messages')
def get_messages():
    # 按时间降序排列分页的消息列表，
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 50, type=int)
    all_messages = app_data.get('messages', [])
    total = len(all_messages)
    messages_with_dt = []
    for msg in all_messages:
        msg_copy = msg.copy()
        dt_obj = None
        time_val = msg_copy.get('time')
        if time_val:
             try:
                 if isinstance(time_val, (int, float)): dt_obj = pd.to_datetime(time_val, unit='s', errors='coerce')
                 else: dt_obj = pd.to_datetime(time_val, errors='coerce')
             except Exception: dt_obj = None 
        msg_copy['_datetime'] = dt_obj if pd.notna(dt_obj) else datetime.datetime.min
        messages_with_dt.append(msg_copy)

    sorted_messages = sorted(messages_with_dt, key=lambda x: x['_datetime'], reverse=True)
    for msg in sorted_messages: del msg['_datetime']

    # 分页
    start_idx = (page - 1) * page_size
    end_idx = page * page_size
    paged_messages = sorted_messages[start_idx:end_idx]
    return jsonify({
        'messages': paged_messages, 'page': page, 'page_size': page_size, 'total': total,
        'total_pages': (total + page_size - 1) // page_size if page_size > 0 else 0
    })
@app.route('/api/app-summary')
def get_app_summary(): return jsonify(app_data.get('app_summary', []))
@app.route('/api/stats')
def get_stats():
    # 各类数据的统计计数
    return jsonify({
        'contacts_count': len(app_data.get('contacts', [])),
        'messages_count': len(app_data.get('messages', [])),
        'app_summary_count': len(app_data.get('app_summary', [])),
        'wechat_groups_count': len(app_data.get('wechat_groups', [])),
        'wechat_contacts_count': len(app_data.get('wechat_contacts', [])),
        'call_records_count': len(app_data.get('call_records', []))
    })

# --- 搜索和上下文 API ---
@app.route('/api/search')
def search():
    # 搜索+结果
    global search_engine
    if search_engine is None:
        return jsonify({'error': '搜索引擎未初始化。请先上传数据。'}), 503

    query = request.args.get('q', '').strip()
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 20, type=int)
    search_type = request.args.get('type', 'combined') 
    context_size = request.args.get('context_size', 3, type=int) 

    # 添加到搜索历史记录
    if query:
        if query not in app_data['search_history']:
            app_data['search_history'].insert(0, query)
            app_data['search_history'] = app_data['search_history'][:MAX_SEARCH_HISTORY]
            save_persistent_data() 

    if not query:
        return jsonify({'results': [], 'page': page, 'page_size': page_size, 'total': 0, 'total_pages': 0, 'search_type': search_type, 'query': query})

    # 初始化搜索引擎——显示前500条结果
    results = []
    if search_type == 'sender': results = search_engine.search_by_sender(query, top_n=500)
    elif search_type == 'keyword': results = search_engine.keyword_search(query, top_n=500)
    elif search_type == 'semantic': results = search_engine.semantic_search(query, top_n=500)
    else: results = search_engine.combined_search(query, top_n=500)
    results = results or []

    # 格式化结果 (高亮, 上下文, 收藏状态)
    formatted_results = []
    seen_ids = set() 
    favorite_ids = {(fav['type'], str(fav['id'])) for fav in app_data.get('favorites', [])} # 快速查找收藏项

    for result in results:
        if not isinstance(result, dict): continue 
        result_key = f"{result.get('type', 'unknown')}_{result.get('id', 'no_id')}"
        if result_key in seen_ids: continue # 跳过重复项
        seen_ids.add(result_key)

        formatted_result_data = result.copy()
        item_type = formatted_result_data.get('type')
        item_id = str(formatted_result_data.get('id', ''))

        # 检查if收藏项
        formatted_result_data['is_favorite'] = (item_type, item_id) in favorite_ids

        # 高亮
        highlight_source = None 
        if item_type == 'message' and 'content' in formatted_result_data:
            original_content = str(formatted_result_data['content'] or '')
            formatted_result_data['highlighted_content'] = search_engine.highlight_matches(original_content, query)
            highlight_source = 'content'
            if context_size > 0 and item_id:
                context_messages = search_engine.find_conversation_context(item_id, window_size=context_size)
                # 上下文消息也高亮
                for ctx_msg in context_messages:
                    if 'content' in ctx_msg:
                        ctx_msg['highlighted_content'] = search_engine.highlight_matches(str(ctx_msg['content'] or ''), query)
                formatted_result_data['conversation_context'] = context_messages
        elif item_type == 'contact' and 'name' in formatted_result_data:
            if 'name' in formatted_result_data: formatted_result_data['highlighted_name'] = search_engine.highlight_matches(str(formatted_result_data['name'] or ''), query)
            if 'phone' in formatted_result_data: formatted_result_data['highlighted_phone'] = search_engine.highlight_matches(str(formatted_result_data['phone'] or ''), query)
            highlight_source = 'name/phone'
        elif item_type == 'wechat_group' and 'group_name' in formatted_result_data:
            if 'group_name' in formatted_result_data: formatted_result_data['highlighted_group_name'] = search_engine.highlight_matches(str(formatted_result_data['group_name'] or ''), query)
            if 'announcement' in formatted_result_data: formatted_result_data['highlighted_announcement'] = search_engine.highlight_matches(str(formatted_result_data.get('announcement','')), query)
            highlight_source = 'group_name/announcement'
        elif item_type == 'wechat_contact':
             if 'nickname' in formatted_result_data: formatted_result_data['highlighted_nickname'] = search_engine.highlight_matches(str(formatted_result_data['nickname'] or ''), query)
             if 'remark' in formatted_result_data: formatted_result_data['highlighted_remark'] = search_engine.highlight_matches(str(formatted_result_data['remark'] or ''), query)
             if 'phone' in formatted_result_data: formatted_result_data['highlighted_phone'] = search_engine.highlight_matches(str(formatted_result_data.get('phone','')), query)
             highlight_source = 'wechat_contact'

        formatted_results.append({
            'score': formatted_result_data.get('score', 0),
            'data': formatted_result_data,
            'highlight_source': highlight_source
        })

    # 分页
    total_results = len(formatted_results)
    start_idx = (page - 1) * page_size
    end_idx = page * page_size
    paged_results = formatted_results[start_idx:end_idx]

    return jsonify({
        'results': paged_results, 'page': page, 'page_size': page_size, 'total': total_results,
        'total_pages': (total_results + page_size - 1) // page_size if page_size > 0 else 1,
        'search_type': search_type, 'query': query
    })

@app.route('/api/conversation-context')
def get_conversation_context():
    # 上下文对话
    global search_engine
    if search_engine is None:
        return jsonify({'error': '搜索引擎未初始化。'}), 503

    message_id = request.args.get('message_id', '')
    context_size = request.args.get('context_size', 3, type=int)
    query = request.args.get('q', '') 

    if not message_id:
        return jsonify({'context': [], 'error': '缺少 message_id'}), 400

    context_messages = search_engine.find_conversation_context(message_id, window_size=context_size)

    if query: 
        for msg in context_messages:
            if 'content' in msg:
                msg['highlighted_content'] = search_engine.highlight_matches(str(msg['content'] or ''), query)

    return jsonify({'context': context_messages})

@app.route('/api/analyze-conversation')
def analyze_conversation():
    # 分析对话数据+统计信息
    global search_engine
    if search_engine is None:
        return jsonify({'error': '搜索引擎未初始化。'}), 503

    query = request.args.get('q', '') 
    start_time_str = request.args.get('start_time', '') 
    end_time_str = request.args.get('end_time', '')  
    time_range = [start_time_str, end_time_str] if start_time_str or end_time_str else None 

    analysis = search_engine.analyze_conversation(query, time_range) 
    return jsonify(analysis)

# --- 搜索历史 API ---
@app.route('/api/search-history')
def get_search_history():
    return jsonify({'search_history': app_data.get('search_history', [])})

@app.route('/api/search-history/clear', methods=['POST'])
def clear_search_history():
    # 清空搜索历史
    app_data['search_history'] = []
    save_persistent_data() 
    return jsonify({'status': 'success', 'message': '搜索历史已清空'})

# --- 收藏夹 API ---
@app.route('/api/favorites/add', methods=['POST'])
def add_favorite():
    data = request.json
    item_type = data.get('type')
    item_id = data.get('id')
    query = data.get('query', '') 

    if not item_type or not item_id:
        return jsonify({'status': 'error', 'message': '缺少项目类型或ID'}), 400
    item_id = str(item_id) 

    favorite_item = {'type': item_type, 'id': item_id, 'query': query}
    found = False
    for i, existing_fav in enumerate(app_data['favorites']):
         if existing_fav.get('type') == item_type and str(existing_fav.get('id')) == item_id:
              app_data['favorites'][i]['query'] = query 
              found = True
              break
    if not found:
        app_data['favorites'].append(favorite_item)

    save_persistent_data() # 保存更改
    return jsonify({'status': 'success', 'message': '项目已添加到收藏夹' if not found else '收藏夹项目已更新'})

@app.route('/api/favorites/remove', methods=['POST'])
def remove_favorite():
    # 从收藏夹移除
    data = request.json
    item_type = data.get('type')
    item_id = data.get('id')
    if not item_type or not item_id:
        return jsonify({'status': 'error', 'message': '缺少项目类型或ID'}), 400
    item_id = str(item_id) 

    initial_length = len(app_data['favorites'])
    # 过滤移除的
    app_data['favorites'] = [
        fav for fav in app_data['favorites']
        if not (fav.get('type') == item_type and str(fav.get('id')) == item_id)
    ]
    removed = len(app_data['favorites']) < initial_length # 检查if移除了

    if removed:
        save_persistent_data() # 保存更改
        return jsonify({'status': 'success', 'message': '项目已从收藏夹移除'})
    else:
        return jsonify({'status': 'error', 'message': '未在收藏夹中找到该项目'}), 404

@app.route('/api/favorites')
def get_favorites():
    # 收藏夹列表
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 20, type=int)
    favorite_ids_with_query = app_data.get('favorites', [])
    full_favorites = []
    not_found_count = 0 # 记录未找到的收藏

    # 查找映射表（if数据量巨大，可以考虑优化）
    message_map = {str(msg.get('id')): msg for msg in app_data.get('messages', []) if msg.get('id')}
    contact_map = {str(con.get('id')): con for con in app_data.get('contacts', []) if con.get('id')}
    group_map = {str(grp.get('group_id')): grp for grp in app_data.get('wechat_groups', []) if grp.get('group_id')}
    wx_contact_map = {str(wxc.get('wechat_id')): wxc for wxc in app_data.get('wechat_contacts', []) if wxc.get('wechat_id')}

    # traverse收藏项信息
    for fav_info in favorite_ids_with_query:
        item_type = fav_info.get('type')
        item_id = str(fav_info.get('id')) 
        original_query = fav_info.get('query', '') 

        found_item = None
        try:
            if item_type == 'message': found_item = message_map.get(item_id)
            elif item_type == 'contact': found_item = contact_map.get(item_id)
            elif item_type == 'wechat_group': found_item = group_map.get(item_id)
            elif item_type == 'wechat_contact': found_item = wx_contact_map.get(item_id)
            # 添加其他类型的查找

            if found_item:
                full_item = found_item.copy()
                full_item['favorite_type'] = item_type
                full_item['is_favorite'] = True 
                full_item['original_query'] = original_query 
                full_favorites.append({'score': 1.0, 'data': full_item})
            else:
                not_found_count += 1
                logging.warning(f"未找到收藏项：type={item_type}, id={item_id}")

        except Exception as lookup_e:
             logging.error(f"查找收藏项时出错：type={item_type}, id={item_id}, error={lookup_e}")
             not_found_count += 1

    # 分页
    total_favorites = len(full_favorites)
    start_idx = (page - 1) * page_size
    end_idx = page * page_size
    paged_favorites = full_favorites[start_idx:end_idx]

    return jsonify({
        'results': paged_favorites, 'page': page, 'page_size': page_size,
        'total': total_favorites,
        'total_pages': (total_favorites + page_size - 1) // page_size if page_size > 0 else 1,
        'not_found_count': not_found_count 
    })


# --- 应用入口 ---
if __name__ == '__main__':
    try:
        os.makedirs('uploads', exist_ok=True)
        os.makedirs('results', exist_ok=True)
        logging.info("必要的目录 'uploads' 和 'results' 已存在或创建。")
    except OSError as e:
        logging.error(f"创建目录失败: {e}")

    load_persistent_data()

    # 初始化搜索引擎
    if search_engine is None:
        search_engine = EnhancedSearch()
        logging.info("搜索引擎在启动时初始化。")

    logging.info("启动 Flask 应用...")
    app.run(host='0.0.0.0', port=5003, debug=True)