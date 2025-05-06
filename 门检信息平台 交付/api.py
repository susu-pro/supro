import datetime

def get_wechat_data_for_api():
    mock_app_data = {
        'wechat_contacts': [
            {'wechat_id': 'wxid_aaa', 'nickname': '张三', 'remark': '同事', 'phone': '13800138000', 'details': {'头像': 'url1'}},
            {'wechat_id': 'wxid_bbb', 'nickname': '李四', 'remark': '', 'phone': '13900139000', 'details': {'头像': 'url2'}},
        ],
        'wechat_groups': [
            {'group_id': 'group_123', 'group_name': '家庭群', 'details': {'人数': 5, '群公告': '常回家看看'}},
            {'group_id': 'group_456', 'group_name': '工作讨论组', 'details': {'人数': 12, '群公告': ''}},
        ],
        'messages': [ 
            {
                'id': 'msg_001',
                'sender': '张三', 
                'content': '你好',
                'time': '2023-10-27 10:00:00', 
                'is_sent': False,
                'source_file': 'wechat_msg_aaa.json',
                'conversation_id': 'wxid_bbb',
                'conversation_type': 'single' # 'single' or 'group'
            },
             {
                'id': 'msg_002',
                'sender': '李四', 
                'content': '今天天气不错',
                'time': 1698372120,
                'is_sent': False,
                'source_file': 'wechat_msg_bbb.json',
                'conversation_id': 'wxid_aaa',
                'conversation_type': 'single'
            },
            {
                'id': 'msg_003',
                'sender': '张三', 
                'content': '收到通知',
                'time': '2023-10-27 11:05:30',
                'is_sent': False,
                'source_file': 'wechat_group_123.json',
                'conversation_id': 'group_123',
                'conversation_type': 'group'
            }
        ]
    }

    wechat_contacts = mock_app_data['wechat_contacts']
    wechat_groups = mock_app_data['wechat_groups']
    wechat_messages = mock_app_data['messages']

    # --- 返回结构 ---
    response_data = {
        "code": 0,  
        "message": "成功获取微信数据", 
        "timestamp": datetime.datetime.now().isoformat(), 
        "data": {
            "contacts": wechat_contacts,
            "groups": wechat_groups,
            "messages": wechat_messages, 
            "stats": { 
                "contact_count": len(wechat_contacts),
                "group_count": len(wechat_groups),
                "message_count": len(wechat_messages) 
            }
        }
    }

    return response_data
