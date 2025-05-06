import pandas as pd
import numpy as np
import jieba
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import re
from collections import Counter
import math
from scipy.sparse import csr_matrix

class EnhancedSearch:
    """结合关键词搜索和语义搜索"""
    
    def __init__(self):
        self.message_df = None  
        self.contact_df = None  
        self.bm25_index = None 
        self.tfidf_vectorizer = None  
        self.tfidf_matrix = None  
        self.doc_content = []  
        self.doc_metadata = []  
        
    def load_data(self, messages, contacts, wechat_groups, wechat_contacts):
        # 转换消息数据为DataFrame
        if messages:
            self.message_df = pd.DataFrame(messages)
            # 确保时间字段格式一致
            if 'time' in self.message_df.columns:
                self.message_df['time'] = pd.to_datetime(self.message_df['time'], errors='coerce')
        else:
            self.message_df = pd.DataFrame(columns=['id', 'sender', 'content', 'time', 'is_sent', 'source_file'])
        
        # 转换联系人数据为DataFrame
        if contacts:
            contact_data = []
            for contact in contacts:
                flat_contact = {
                    'id': contact.get('id', ''),
                    'name': contact.get('name', '')
                }
                if 'details' in contact and isinstance(contact['details'], dict):
                    for key, value in contact['details'].items():
                        flat_contact[key] = value
                contact_data.append(flat_contact)
            self.contact_df = pd.DataFrame(contact_data)
        else:
            self.contact_df = pd.DataFrame(columns=['id', 'name'])
        
        # 为数据创建索引
        self._create_search_index(messages, contacts, wechat_groups, wechat_contacts)
        
    def _create_search_index(self, messages, contacts, wechat_groups, wechat_contacts):
        self.doc_content = []
        self.doc_metadata = []
        
        # 为消息创建文档
        for msg in messages or []:
            text = f"{msg.get('sender', '')} {msg.get('content', '')}"
            words = [word for word in jieba.cut(text) if word.strip()]
            self.doc_content.append(' '.join(words))  # 空格连接的分词结果，用于TF-IDF
            self.doc_metadata.append({
                'type': 'message',
                'id': msg.get('id', ''),
                'sender': msg.get('sender', ''),
                'content': msg.get('content', ''),
                'time': msg.get('time', ''),
                'source': msg.get('source_file', ''),
                'original_text': text  
            })
        
        # 为联系人创建文档
        for contact in contacts or []:
            phone = contact.get('details', {}).get('电话号码', '')
            text = f"{contact.get('name', '')} {phone}"
            words = [word for word in jieba.cut(text) if word.strip()]
            self.doc_content.append(' '.join(words))
            self.doc_metadata.append({
                'type': 'contact',
                'id': contact.get('id', ''),
                'name': contact.get('name', ''),
                'phone': phone,
                'original_text': text
            })
        
        # 为微信群组创建文档
        for group in wechat_groups or []:
            announcement = group.get('details', {}).get('群公告', '')
            text = f"{group.get('group_name', '')} {announcement}"
            words = [word for word in jieba.cut(text) if word.strip()]
            self.doc_content.append(' '.join(words))
            self.doc_metadata.append({
                'type': 'wechat_group',
                'id': group.get('group_id', ''),
                'group_name': group.get('group_name', ''),
                'announcement': announcement,
                'member_count': group.get('details', {}).get('人数', ''),
                'original_text': text
            })
        
        # 为微信联系人创建文档
        for contact in wechat_contacts or []:
            text = f"{contact.get('nickname', '')} {contact.get('remark', '')} {contact.get('group_name', '')}"
            words = [word for word in jieba.cut(text) if word.strip()]
            self.doc_content.append(' '.join(words))
            self.doc_metadata.append({
                'type': 'wechat_contact',
                'id': contact.get('wechat_id', ''),
                'nickname': contact.get('nickname', ''),
                'remark': contact.get('remark', ''),
                'group_name': contact.get('group_name', ''),
                'phone': contact.get('phone', ''),
                'original_text': text
            })
        
        # BM25
        if self.doc_content:
            tokenized_docs = [doc.split() for doc in self.doc_content] 
            self.bm25_index = BM25(tokenized_docs)
            
            # TF-IDF向量
            self.tfidf_vectorizer = TfidfVectorizer(analyzer='word', token_pattern=r'\S+')
            self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(self.doc_content)
    
    def keyword_search(self, query, top_n=50):
        if not self.bm25_index or not query:
            return []
        
        # 分词
        query_tokens = [word for word in jieba.cut(query) if word.strip()]
        
        # 搜索
        results = self.bm25_index.search(query_tokens, top_n=top_n)
        
        # 结果
        search_results = []
        for idx, score in results:
            if idx < len(self.doc_metadata):
                metadata = self.doc_metadata[idx].copy()
                metadata['score'] = score
                metadata['match_type'] = 'keyword'
                search_results.append(metadata)
        
        return search_results
    
    def semantic_search(self, query, top_n=50):
        if not self.tfidf_vectorizer or not query:
            return []
        
        # 分词
        query_tokens = ' '.join([word for word in jieba.cut(query) if word.strip()])
        
        # 转换查询为TF-IDF向量
        query_vector = self.tfidf_vectorizer.transform([query_tokens])
        
        # 余弦相似度
        cosine_similarities = cosine_similarity(query_vector, self.tfidf_matrix).flatten()
        
        # 前N个结果
        sim_scores = list(enumerate(cosine_similarities))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        top_indices = sim_scores[:top_n]
        
        # 结果
        search_results = []
        for idx, score in top_indices:
            if score > 0 and idx < len(self.doc_metadata):
                metadata = self.doc_metadata[idx].copy()
                metadata['score'] = float(score)  
                metadata['match_type'] = 'semantic'
                search_results.append(metadata)
        
        return search_results
    
    def combined_search(self, query, top_n=50):
        """混合搜索"""
        # 关键词搜索结果
        keyword_results = self.keyword_search(query, top_n=top_n)
        
        # 语义搜索结果
        semantic_results = self.semantic_search(query, top_n=top_n)
        
        # 合并结果（去重）
        result_dict = {}
        for result in keyword_results + semantic_results:
            result_id = f"{result['type']}_{result['id']}"
            if result_id not in result_dict or result['score'] > result_dict[result_id]['score']:
                result_dict[result_id] = result
        
        # 列表并排序
        combined_results = list(result_dict.values())
        combined_results.sort(key=lambda x: x['score'], reverse=True)
        
        return combined_results[:top_n]
    
    def highlight_matches(self, text, query, window_size=20):
        if not text or not query:
            return text
        
        # 分词
        query_tokens = [word for word in jieba.cut(query) if word.strip()]
        
        # 查找匹配的位置
        matches = []
        for token in query_tokens:
            start = 0
            while True:
                pos = text.find(token, start)
                if pos == -1:
                    break
                matches.append((pos, pos + len(token)))
                start = pos + 1
        
        # 没匹配，返回原文
        if not matches:
            return text
        
        # 按起始位置排序
        matches.sort(key=lambda x: x[0])
        
        # 合并重叠的匹配
        merged_matches = []
        current_start, current_end = matches[0]
        
        for start, end in matches[1:]:
            if start <= current_end:
                current_end = max(current_end, end)
            else:
                merged_matches.append((current_start, current_end))
                current_start, current_end = start, end
        
        merged_matches.append((current_start, current_end))
        
       
        highlighted = ""
        last_end = 0
        
        for start, end in merged_matches:
            context_start = max(0, start - window_size)
            if context_start > last_end:
                highlighted += "... "
            else:
                context_start = last_end
                
            highlighted += text[context_start:start]
            
            # 添加高亮部分
            highlighted += f"【{text[start:end]}】"
            
            last_end = end
        
        # 添加最后一部分文本
        context_end = min(len(text), last_end + window_size)
        highlighted += text[last_end:context_end]
        
        if context_end < len(text):
            highlighted += " ..."
        
        return highlighted
    
    def search_by_sender(self, sender_name, top_n=50):
        """根据发送者搜索消息"""
        if not self.message_df.empty and 'sender' in self.message_df.columns:
            # 使用模糊匹配查找发送者
            matched_messages = self.message_df[self.message_df['sender'].str.contains(sender_name, na=False)]
            
            # 取前N条结果
            results = matched_messages.head(top_n).to_dict('records')
            
            # 组织结果
            search_results = []
            for msg in results:
                search_results.append({
                    'type': 'message',
                    'id': msg.get('id', ''),
                    'sender': msg.get('sender', ''),
                    'content': msg.get('content', ''),
                    'time': msg.get('time', ''),
                    'source': msg.get('source_file', ''),
                    'score': 1.0,  
                    'match_type': 'sender',
                    'original_text': f"{msg.get('sender', '')} {msg.get('content', '')}"
                })
            
            return search_results
        return []
    
    def analyze_conversation(self, query=None, time_range=None):
        """按关键词或时间范围筛选"""
        if self.message_df.empty:
            return {
                'total_messages': 0,
                'sender_stats': {},
                'time_stats': {},
                'keyword_stats': {}
            }
        
        # 筛选消息
        filtered_df = self.message_df.copy()
        
        if query:
            # 根据关键词筛选
            query_tokens = [word for word in jieba.cut(query) if word.strip()]
            mask = filtered_df['content'].str.contains('|'.join(query_tokens), na=False)
            filtered_df = filtered_df[mask]
        
        if time_range and len(time_range) == 2:
            # 根据时间范围筛选
            start_time, end_time = time_range
            if 'time' in filtered_df.columns:
                filtered_df = filtered_df[(filtered_df['time'] >= start_time) & 
                                        (filtered_df['time'] <= end_time)]
        
        if filtered_df.empty:
            return {
                'total_messages': 0,
                'sender_stats': {},
                'time_stats': {},
                'keyword_stats': {}
            }
        
        # 基本统计信息
        total_messages = len(filtered_df)
        
        # 发送者统计
        sender_stats = filtered_df['sender'].value_counts().to_dict()
        
        # 时间统计（按天）
        if 'time' in filtered_df.columns:
            filtered_df['date'] = filtered_df['time'].dt.date
            time_stats = filtered_df['date'].value_counts().to_dict()
            time_stats = {str(k): v for k, v in time_stats.items()}
        else:
            time_stats = {}
        
        # 关键词统计
        all_words = []
        for content in filtered_df['content'].dropna():
            words = [word for word in jieba.cut(content) if word.strip() and len(word) > 1]
            all_words.extend(words)
        
        # 计算词频
        word_counter = Counter(all_words)
        keyword_stats = dict(word_counter.most_common(50))
        
        return {
            'total_messages': total_messages,
            'sender_stats': sender_stats,
            'time_stats': time_stats,
            'keyword_stats': keyword_stats
        }


# BM25算法实现
class BM25:
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
                if word not in self.df:
                    self.df[word] = 1
                else:
                    self.df[word] += 1
        
        # 计算IDF值
        for word, freq in self.df.items():
            self.idf[word] = math.log((self.D - freq + 0.5) / (freq + 0.5) + 1.0)
    
    def get_scores(self, query):
        """计算查询与所有文档的相关度分数"""
        scores = [0] * self.D
        query_freqs = Counter(query)
        
        for word, freq in query_freqs.items():
            if word not in self.idf:
                continue
                
            for i, doc in enumerate(self.documents):
                if word not in self.f[i]:
                    continue
                    
                doc_len = len(doc)
                doc_freq = self.f[i][word]
                numerator = self.idf[word] * doc_freq * (self.k1 + 1)
                denominator = doc_freq + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                scores[i] += (numerator / denominator) * freq
        
        return scores
    
    def search(self, query, top_n=50):
        """搜索相关文档"""
        scores = self.get_scores(query)
        top_indices = np.argsort(scores)[::-1][:top_n]
        return [(i, scores[i]) for i in top_indices if scores[i] > 0]