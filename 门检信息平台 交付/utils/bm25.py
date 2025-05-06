import math
import numpy as np
from collections import Counter

class BM25:
    """
    BM25搜索算法实现
    """
    def __init__(self, documents):
        """
        初始化BM25搜索模型
        """
        self.documents = documents
        self.D = len(documents)
        self.avgdl = sum([len(doc) for doc in documents]) / self.D if self.D > 0 else 0
        self.f = [] 
        self.df = {} 
        self.idf = {} 
        self.k1 = 1.5
        self.b = 0.75
        
        # 初始化模型参数
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
    
    def search(self, query, top_n=10):
        """
        搜索相关文档
        """
        scores = self.get_scores(query)
        top_indices = np.argsort(scores)[::-1][:top_n]
        return [(i, scores[i]) for i in top_indices if scores[i] > 0]