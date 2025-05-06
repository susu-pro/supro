import json
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
from matplotlib.lines import Line2D
import os
from openpyxl import Workbook
import re
import io
import base64
from flask import Blueprint, request, jsonify, send_file, Response
import tempfile
import shutil
import logging

call_records_bp = Blueprint('call_records', __name__, url_prefix='/api/call-records')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

UPLOAD_FOLDER = './uploads/call_records'
RESULT_FOLDER = './results'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

def merge_json_files(folder_path):
    """所有 JSON 文件合并为一个字符串"""
    all_json_content = ""
    for root, dirs, files in os.walk(folder_path):
        for file in files:
            if file.endswith(".json"):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                        all_json_content += content
                except Exception as e:
                    logging.error(f"读取文件 {file_path} 时出现错误: {e}")
    data = parse_json_data(all_json_content)
    return data

def parse_json_data(data_str):
    """解析字符串"""
    items = data_str.split(";")
    json_list = []

    for index, item in enumerate(items, start=1):
        if not item.strip():
            continue

        equal_index = item.find("=")
        if equal_index == -1:
            logging.warning(f"第 {index} 项未找到等号，跳过: {item}")
            continue

        json_str = item[equal_index + 1:].strip()
        json_str = json_str.replace('\n', '').replace(' ', '')
        json_str = json_str.replace('\ufeff', '') 
        # 修正时间为 "YYYY-MM-DD HH:MM:SS"
        json_str = re.sub(r'(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})', r'\1 \2', json_str)
        # 使用正则表达式去除JSON中结尾处多余的逗号
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)

        try:
            json_data = json.loads(json_str)
            json_list.append(json_data)
        except json.JSONDecodeError as e:
            logging.error(f"第 {index} 项无法解析 JSON: {json_str}，错误信息: {e}")

    return json_list

def ensure_excel_exists(output_path):
    """确保 Excel 文件存在"""
    if not os.path.exists(output_path):
        wb = Workbook()
        wb.save(output_path)

def write_to_excel(data, output_path):
    """JSON 数据写入 Excel"""
    ensure_excel_exists(output_path)

    all_data = []
    for item in data:
        config_info = item.get("config", {})
        for content in item.get("contents", []):
            # 合并 config + content 
            combined = {**config_info, **content}
            all_data.append(combined)

    if not all_data:
        logging.warning("没有从JSON数据中提取到有效记录，无法写入Excel。")
        return None

    df = pd.DataFrame(all_data)

    columns_to_keep = ['content', 'isDelete', 'sender', 'time']
    for col in columns_to_keep:
        if col not in df.columns:
            df[col] = None 

    df = df[columns_to_keep]

    column_rename_mapping = {
        'content': '通话时长(ct)',
        'isDelete': '是否删除(del)',
        'sender': '通话号码(sd)',
        'time': '开始通话时间(ti)'
    }
    df = df.rename(columns=column_rename_mapping)

    df['开始通话时间(ti)'] = pd.to_datetime(df['开始通话时间(ti)'], errors='coerce')
    df = df.dropna(subset=['开始通话时间(ti)'])
    df['是否删除(del)'] = df['是否删除(del)'].replace({'是': 1, '否': 0, True: 1, False: 0}).fillna(0).astype(int)

    if df.empty:
        logging.warning("处理后的数据为空，Excel文件可能只包含表头。")
        # 避免空文件
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            pd.DataFrame(columns=df.columns).to_excel(writer, sheet_name='总表', index=False)
        return df


    # Sheet1: 按照开始通话时间
    df_sorted_by_time = df.sort_values(by='开始通话时间(ti)')

    # Sheet2: 按通话次数
    call_counts = df.groupby('通话号码(sd)').size().reset_index(name='通话次数')
    df_sorted_by_calls = call_counts.sort_values(by='通话次数', ascending=False)

    # Sheet3: 按通话总时长
    df['通话时长秒数'] = df['通话时长(ct)'].apply(convert_to_seconds)
    call_durations = df.groupby('通话号码(sd)')['通话时长秒数'].sum().reset_index(name='总通话时长(秒)')
    df_sorted_by_duration = call_durations.sort_values(by='总通话时长(秒)', ascending=False)

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        df_sorted_by_time.to_excel(writer, sheet_name='总表', index=False)
        df_sorted_by_calls.to_excel(writer, sheet_name='按照通话次数排序', index=False)
        df_sorted_by_duration.to_excel(writer, sheet_name='按照通话总时长排序(秒)', index=False)

    return df

def convert_to_seconds(duration_str):
    if not isinstance(duration_str, str):
        return 0

    parts = duration_str.split(":")
    if len(parts) == 3:
        try:
            hours, minutes, seconds = map(int, parts)
            return hours * 3600 + minutes * 60 + seconds
        except ValueError:
            return 0 
    return 0

def plot_call_info(df, output_path, call_num=5):
    """
    绘制通话信息图并保存。
    """
    
    plt.rcParams["font.sans-serif"] = ["SimHei"]
    plt.rcParams["axes.unicode_minus"] = False
    plt.clf() 

    required_columns = ['通话号码(sd)', '开始通话时间(ti)', '是否删除(del)', '通话时长(ct)']
    if df is None or df.empty or not all(col in df.columns for col in required_columns):
        logging.warning(f"数据不足或缺少必要列，无法生成图表 {output_path}")
        plt.figure(figsize=(10, 6))
        plt.text(0.5, 0.5, "没有有效的通话数据绘制图表", ha='center', va='center', fontsize=14)
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        return output_path

   
    if '通话时长秒数' not in df.columns:
        df["通话时长秒数"] = df['通话时长(ct)'].apply(convert_to_seconds)

    df = df.sort_values(by='开始通话时间(ti)')

    
    sd_counts = df['通话号码(sd)'].value_counts()
    valid_sd = sd_counts[sd_counts > call_num].index

    if len(valid_sd) == 0:
        logging.info(f"没有通话次数超过 {call_num} 次的号码，生成空图表 {output_path}")
        plt.figure(figsize=(10, 6))
        plt.text(0.5, 0.5, f"没有通话次数超过{call_num}次的号码", ha='center', va='center', fontsize=14)
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        return output_path

    df_filtered = df[df['通话号码(sd)'].isin(valid_sd)].copy() 

    # 给每个号码分配Y轴位置
    unique_numbers = df_filtered['通话号码(sd)'].unique()
    number_index_mapping = {number: index for index, number in enumerate(unique_numbers)}
    df_filtered["sd_index"] = df_filtered['通话号码(sd)'].map(number_index_mapping)

    plt.figure(figsize=(12, 8)) 

    # 绘制未删除记录 （圆形）
    un_deleted = df_filtered[df_filtered['是否删除(del)'] == 0]
    if not un_deleted.empty:
        sizes_un_deleted = 5 + un_deleted["通话时长秒数"] * 0.3
        plt.scatter(
            un_deleted['开始通话时间(ti)'], un_deleted["sd_index"],
            s=sizes_un_deleted, c="blue", label="未删除", alpha=0.6
        )

    # 绘制已删除记录 (方形标记)
    deleted = df_filtered[df_filtered['是否删除(del)'] == 1]
    if not deleted.empty:
        sizes_deleted = 5 + deleted["通话时长秒数"] * 0.3
        plt.scatter(
            deleted['开始通话时间(ti)'], deleted["sd_index"],
            s=sizes_deleted, marker="s", c="red", label="已删除", alpha=0.6
        )

    # Y轴为电话号码
    plt.yticks(range(len(unique_numbers)), unique_numbers, fontsize=8) 

    plt.xlabel("开始通话时间")
    plt.ylabel("通话对象号码")
    plt.title(f"机主通话信息图 (通话次数 > {call_num}次)")
    plt.grid(axis='x', linestyle='--', alpha=0.6) 

    # 优化X轴刻度显示
    min_time = df_filtered['开始通话时间(ti)'].min()
    max_time = df_filtered['开始通话时间(ti)'].max()
    time_diff_days = (max_time - min_time).days
    if time_diff_days <= 14: # 两周内显示日期
         tick_interval = pd.Timedelta(days=1)
         date_format = "%m-%d"
    elif time_diff_days <= 90: # 三个月内显示月日
        tick_interval = pd.Timedelta(weeks=1)
        date_format = "%m-%d"
    else: # 更长时间显示年月
        tick_interval = pd.Timedelta(weeks=4) 
        date_format = "%Y-%m"

    current_time = min_time
    tick_positions = []
    tick_labels = []
    while current_time <= max_time:
        tick_positions.append(current_time)
        tick_labels.append(current_time.strftime(date_format))
        # 避免无限循环
        if tick_interval.total_seconds() == 0: break
        current_time += tick_interval
        if len(tick_positions) > 50: break 

    plt.xticks(tick_positions, tick_labels, rotation=30, ha='right', fontsize=8) 

    # 设置图例
    legend_elements = [
        Line2D([0], [0], marker="o", color="w", label="未删除", markerfacecolor="blue", markersize=8),
        Line2D([0], [0], marker="s", color="w", label="已删除", markerfacecolor="red", markersize=8),
    ]
    # 添加图例
    plt.legend(handles=legend_elements, loc="center left", bbox_to_anchor=(1.02, 0.5), title="状态")

    plt.tight_layout(rect=[0, 0, 0.85, 1]) 
    plt.savefig(output_path, dpi=300)
    plt.close() 

    return output_path


def generate_call_stats(df):
    """DataFrame生成通话统计"""
    if df is None or df.empty:
        return {
            "total_calls": 0, "total_duration": "0:00:00", "top_contacts": [],
            "deleted_calls": 0, "time_range": {"start": None, "end": None}
        }

    total_calls = len(df)
    deleted_calls = df['是否删除(del)'].sum()

    # 确保有通话时长秒数列
    if '通话时长秒数' not in df.columns:
        df['通话时长秒数'] = df['通话时长(ct)'].apply(convert_to_seconds)

    total_seconds = df['通话时长秒数'].sum()
    hours, rem = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    total_duration_str = f"{int(hours)}:{int(minutes):02d}:{int(seconds):02d}"

    min_time = df['开始通话时间(ti)'].min()
    max_time = df['开始通话时间(ti)'].max()
    time_range = {
        "start": min_time.strftime("%Y-%m-%d %H:%M:%S") if pd.notna(min_time) else None,
        "end": max_time.strftime("%Y-%m-%d %H:%M:%S") if pd.notna(max_time) else None
    }

    # 计算通话次数和总时长的Top N联系人
    call_counts = df.groupby('通话号码(sd)').size().reset_index(name='通话次数')
    contact_durations = df.groupby('通话号码(sd)')['通话时长秒数'].sum().reset_index(name='总时长(秒)')
    top_contacts_stats = call_counts.merge(contact_durations, on='通话号码(sd)', how='left')
    top_contacts_stats = top_contacts_stats.sort_values(by='通话次数', ascending=False).head(10) 

    def format_duration(secs):
        h, r = divmod(secs, 3600)
        m, s = divmod(r, 60)
        return f"{int(h)}:{int(m):02d}:{int(s):02d}"

    contacts_list = [
        {
            "phone": row['通话号码(sd)'],
            "call_count": int(row['通话次数']),
            "total_duration": format_duration(row['总时长(秒)']),
            "total_seconds": int(row['总时长(秒)'])
        } for _, row in top_contacts_stats.iterrows()
    ]

    return {
        "total_calls": total_calls,
        "total_duration": total_duration_str,
        "top_contacts": contacts_list,
        "deleted_calls": int(deleted_calls),
        "time_range": time_range
    }

def process_uploaded_files(files, temp_folder):
    """处理上传的文件列表，保存到临时文件夹并合并内容。"""
    os.makedirs(temp_folder, exist_ok=True)
    saved_paths = []
    for file in files:
        if file and file.filename and file.filename.lower().endswith('.json'):
            # 生成唯一文件名
            filename = os.path.basename(file.filename)
            file_path = os.path.join(temp_folder, filename)
            try:
                file.save(file_path)
                saved_paths.append(file_path)
            except Exception as e:
                 logging.error(f"保存文件 {filename} 到 {temp_folder} 时出错: {e}")
        else:
            logging.warning(f"跳过无效文件或非JSON文件: {file.filename if file else 'N/A'}")

    if not saved_paths:
        raise ValueError("没有成功保存任何有效的JSON文件。")

    merged_data = merge_json_files(temp_folder)
    return merged_data

def get_excel_data(excel_path):
    """从Excel文件的'总表'读取数据。"""
    try:
        dtype_spec = {
            '通话时长(ct)': str, 
            '是否删除(del)': 'Int64', 
            '通话号码(sd)': str,
            '开始通话时间(ti)': str 
        }
        df = pd.read_excel(excel_path, sheet_name='总表', dtype=dtype_spec, engine='openpyxl')

        
        df['开始通话时间(ti)'] = pd.to_datetime(df['开始通话时间(ti)'], errors='coerce')
        for col in ['通话时长(ct)', '是否删除(del)', '通话号码(sd)', '开始通话时间(ti)']:
             if col not in df.columns:
                 df[col] = None if col != '是否删除(del)' else pd.NA

        return df
    except FileNotFoundError:
        logging.error(f"Excel文件未找到: {excel_path}")
        return None
    except KeyError as e:
        logging.error(f"Excel文件中缺少必要的Sheet或列: {e} in {excel_path}")
        return None
    except Exception as e:
        logging.error(f"读取Excel文件 {excel_path} 时出现未知错误: {e}")
        return None


# --- API ---

@call_records_bp.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({"error": "请求中缺少 'files' 部分"}), 400

    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({"error": "没有选择有效文件上传"}), 400

    # 临时目录
    temp_dir = tempfile.mkdtemp(prefix="call_records_upload_", dir=UPLOAD_FOLDER)
    output_excel_filename = f"call_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    output_excel_path = os.path.join(RESULT_FOLDER, output_excel_filename)

    try:
        merged_data = process_uploaded_files(files, temp_dir)
        if not merged_data:
             return jsonify({"error": "未从上传的文件中解析出任何数据"}), 400

        df = write_to_excel(merged_data, output_excel_path)
        if df is None:
             return jsonify({"error": "无法生成Excel报告，可能是数据为空或格式错误"}), 400

        stats = generate_call_stats(df)

        return jsonify({
            "success": True,
            "message": f"文件上传并处理成功 ({len(files)} 个文件)",
            "excel_path": output_excel_path, 
            "excel_id": output_excel_filename,
            "stats": stats,
            "record_count": stats.get("total_calls", 0)
        })
    except ValueError as ve: 
         logging.error(f"上传处理失败: {ve}")
         return jsonify({"error": str(ve)}), 400
    except Exception as e:
        logging.exception(f"处理上传文件时发生意外错误") 
        return jsonify({"error": f"服务器内部错误: {str(e)}"}), 500
    finally:
        # 清理临时文件夹
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                 logging.error(f"清理临时文件夹 {temp_dir} 失败: {e}")

@call_records_bp.route('/generate-chart', methods=['POST'])
def generate_chart():
    """
    API端点：根据指定的Excel文件和通话次数阈值生成通话信息图。
    """
    data = request.json
    excel_path_or_id = data.get('excel_path') or data.get('excel_id') 
    call_num_str = data.get('call_num', '5') 

    if not excel_path_or_id:
        return jsonify({"error": "缺少 'excel_path' 或 'excel_id' 参数"}), 400

    try:
        call_num = int(call_num_str)
    except ValueError:
         return jsonify({"error": f"无效的 'call_num' 参数: {call_num_str} (应为整数)"}), 400

    
    excel_path = excel_path_or_id if os.path.isabs(excel_path_or_id) or os.path.exists(excel_path_or_id) else os.path.join(RESULT_FOLDER, excel_path_or_id)

    if not os.path.exists(excel_path):
        return jsonify({"error": f"Excel文件未找到: {excel_path}"}), 404

    try:
        df = get_excel_data(excel_path)
        if df is None: 
            return jsonify({"error": "无法读取Excel数据或数据为空"}), 400

        chart_filename = f"call_info_{datetime.now().strftime('%Y%m%d_%H%M%S')}_n{call_num}.png"
        chart_path = os.path.join(RESULT_FOLDER, chart_filename)
        plot_call_info(df, chart_path, call_num=call_num)

        
        chart_base64 = None
        try:
            with open(chart_path, 'rb') as image_file:
                 chart_base64 = f"data:image/png;base64,{base64.b64encode(image_file.read()).decode('utf-8')}"
        except Exception as e:
             logging.warning(f"无法生成图表 {chart_path} 的Base64预览: {e}")


        return jsonify({
            "success": True,
            "chart_path": chart_path, 
            "chart_id": chart_filename,
            "chart_data": chart_base64 
        })
    except Exception as e:
        logging.exception(f"生成图表时发生意外错误")
        return jsonify({"error": f"服务器内部错误: {str(e)}"}), 500


@call_records_bp.route('/stats', methods=['GET']) 
def get_stats():
    """
    API端点：指定Excel文件中的通话统计信息。
    """
    excel_path_or_id = request.args.get('excel_path') or request.args.get('excel_id')

    if not excel_path_or_id:
        return jsonify({"error": "缺少 'excel_path' 或 'excel_id' 查询参数"}), 400

    excel_path = excel_path_or_id if os.path.isabs(excel_path_or_id) or os.path.exists(excel_path_or_id) else os.path.join(RESULT_FOLDER, excel_path_or_id)

    if not os.path.exists(excel_path):
        return jsonify({"error": f"Excel文件未找到: {excel_path}"}), 404

    try:
        df = get_excel_data(excel_path)
        if df is None:
            return jsonify({"error": "无法读取Excel数据或数据为空"}), 400

        stats = generate_call_stats(df)
        return jsonify({"success": True, "stats": stats})

    except Exception as e:
        logging.exception(f"获取统计信息时发生意外错误")
        return jsonify({"error": f"服务器内部错误: {str(e)}"}), 500


@call_records_bp.route('/download/<file_id>', methods=['GET'])
def download_file(file_id):
    """
    API端点：根据文件ID下载生成的Excel或图表文件。
    """
    if not file_id:
        return jsonify({"error": "未提供文件ID"}), 400

   
    if '..' in file_id or file_id.startswith('/'):
         return jsonify({"error": "无效的文件ID"}), 400

    file_path = os.path.join(RESULT_FOLDER, file_id)
    if not os.path.exists(file_path):
        return jsonify({"error": "文件未找到"}), 404

    try:
        if file_id.lower().endswith('.xlsx'):
            mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            download_name = f"通话记录_{datetime.now().strftime('%Y%m%d')}.xlsx"
        elif file_id.lower().endswith('.png'):
            mime_type = 'image/png'
            download_name = f"通话信息图_{datetime.now().strftime('%Y%m%d')}.png"
        else:
            mime_type = 'application/octet-stream'
            download_name = file_id

        return send_file(
            file_path,
            mimetype=mime_type,
            as_attachment=True,
            download_name=download_name 
        )
    except Exception as e:
        logging.exception(f"下载文件 {file_id} 时发生错误")
        return jsonify({"error": f"下载文件时出错: {str(e)}"}), 500


@call_records_bp.route('/chart-preview/<chart_id>', methods=['GET'])
def chart_preview(chart_id):
    """
    API端点：指定图表文件的Base64编码预览。
    """
    if not chart_id:
        return jsonify({"error": "未提供图表ID"}), 400

    if '..' in chart_id or chart_id.startswith('/'):
         return jsonify({"error": "无效的图表ID"}), 400

    chart_path = os.path.join(RESULT_FOLDER, chart_id)
    if not os.path.exists(chart_path):
        return jsonify({"error": "图表未找到"}), 404

    try:
        with open(chart_path, 'rb') as image_file:
            encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
        return jsonify({
            "success": True,
            "image_data": f"data:image/png;base64,{encoded_image}"
        })
    except Exception as e:
        logging.exception(f"获取图表预览 {chart_id} 时发生错误")
        return jsonify({"error": f"获取图表预览时出错: {str(e)}"}), 500

@call_records_bp.route('/', methods=['GET']) 
def get_call_records():
    """
    API端点：通话记录列表（分页，可按号码过滤）。
    需要提供excel_id参数指定数据源。
    """
    excel_path_or_id = request.args.get('excel_id') 
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 20, type=int) 
    filter_phone = request.args.get('phone', '')

    if not excel_path_or_id:
        return jsonify({"error": "缺少 'excel_id' 查询参数"}), 400

    excel_path = excel_path_or_id if os.path.isabs(excel_path_or_id) or os.path.exists(excel_path_or_id) else os.path.join(RESULT_FOLDER, excel_path_or_id)

    if not os.path.exists(excel_path):
        return jsonify({"error": f"Excel文件未找到: {excel_path}"}), 404

    try:
        df = get_excel_data(excel_path)
        if df is None:
             return jsonify({"error": "无法读取Excel数据或数据为空"}), 400

        # 应用过滤
        if filter_phone:
            df = df[df['通话号码(sd)'].astype(str).str.contains(filter_phone, case=False, na=False)]

        # 按时间降序排列
        df = df.sort_values(by='开始通话时间(ti)', ascending=False)

        total = len(df)
        start = (page - 1) * page_size
        end = start + page_size
        page_data = df.iloc[start:end]

        # 转换为JSON兼容格式
        records = [
            {
                "phone": row['通话号码(sd)'],
                "duration": row['通话时长(ct)'],
                "time": row['开始通话时间(ti)'].strftime("%Y-%m-%d %H:%M:%S") if pd.notna(row['开始通话时间(ti)']) else None,
                "is_deleted": bool(row['是否删除(del)']) # Ensure boolean
            } for _, row in page_data.iterrows()
        ]

        return jsonify({
            "success": True,
            "records": records,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 0
        })
    except Exception as e:
        logging.exception(f"获取通话记录列表时发生错误")
        return jsonify({"error": f"获取通话记录时出错: {str(e)}"}), 500



@call_records_bp.route('/records', methods=['POST'])
def call_records_web():
    """
    (Web平台调用?) 处理通话记录JSON文件上传，生成报告、统计和图表预览。
    与 /upload 类似，但直接返回图表数据。
    """
    if 'files[]' not in request.files:
        return jsonify({"status": "error", "message": "请求中缺少 'files[]' 部分"}), 400

    files = request.files.getlist('files[]')
    if not files or all(f.filename == '' for f in files):
        return jsonify({"status": "error", "message": "没有选择有效文件上传"}), 400

    json_files = [f for f in files if f.filename and f.filename.lower().endswith('.json')]
    if not json_files:
        return jsonify({"status": "error", "message": "未找到有效的JSON文件"}), 400

    temp_dir = tempfile.mkdtemp(prefix="call_records_web_", dir=UPLOAD_FOLDER)
    output_excel_filename = f"call_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}_web.xlsx"
    output_excel_path = os.path.join(RESULT_FOLDER, output_excel_filename)

    try:
        merged_data = process_uploaded_files(json_files, temp_dir)
        if not merged_data:
             return jsonify({"status": "error", "message": "未从上传的文件中解析出任何数据"}), 400

        df = write_to_excel(merged_data, output_excel_path)
        if df is None:
            return jsonify({"status": "error", "message": "无法生成Excel报告"}), 400

        stats = generate_call_stats(df)

        # 生成图表 (默认次数 5)
        call_num_default = 5
        chart_filename = f"call_info_{datetime.now().strftime('%Y%m%d_%H%M%S')}_web_n{call_num_default}.png"
        chart_path = os.path.join(RESULT_FOLDER, chart_filename)
        plot_call_info(df, chart_path, call_num=call_num_default)

        chart_base64 = None
        try:
            with open(chart_path, 'rb') as image_file:
                chart_base64 = f"data:image/png;base64,{base64.b64encode(image_file.read()).decode('utf-8')}"
        except Exception as e:
            logging.warning(f"无法生成图表 {chart_path} 的Base64预览: {e}")

        return jsonify({
            "status": "success",
            "message": f"成功处理 {len(json_files)} 个文件，包含 {stats['total_calls']} 条通话记录",
            "excel_id": output_excel_filename,
            "chart_id": chart_filename,
            "stats": stats,
            "chart_data": chart_base64 
        })
    except ValueError as ve:
         logging.error(f"Web记录处理失败: {ve}")
         return jsonify({"status": "error", "message": str(ve)}), 400
    except Exception as e:
        logging.exception(f"处理Web通话记录时发生意外错误")
        return jsonify({"status": "error", "message": f"服务器内部错误: {str(e)}"}), 500
    finally:
        if os.path.exists(temp_dir):
            try:
                 shutil.rmtree(temp_dir)
            except Exception as e:
                logging.error(f"清理Web临时文件夹 {temp_dir} 失败: {e}")


@call_records_bp.route('/update-chart', methods=['POST'])
def update_call_chart():
    """
    API端点：根据现有Excel文件ID和新的通话次数阈值，重新生成图表。
    """
    data = request.json
    excel_id = data.get('excel_id')
    call_num_str = data.get('call_num', '5')

    if not excel_id:
        return jsonify({"status": "error", "message": "缺少 'excel_id' 参数"}), 400

    try:
        call_num = int(call_num_str)
    except ValueError:
         return jsonify({"status": "error", "message": f"无效的 'call_num' 参数: {call_num_str} (应为整数)"}), 400

    excel_path = os.path.join(RESULT_FOLDER, excel_id)
    if not os.path.exists(excel_path):
        return jsonify({"status": "error", "message": "Excel文件未找到"}), 404

    try:
        df = get_excel_data(excel_path)
        if df is None:
            return jsonify({"status": "error", "message": "无法读取Excel数据或数据为空"}), 400

        # 生成新图表
        chart_filename = f"call_info_{datetime.now().strftime('%Y%m%d_%H%M%S')}_n{call_num}.png"
        chart_path = os.path.join(RESULT_FOLDER, chart_filename)
        plot_call_info(df, chart_path, call_num=call_num)

        chart_base64 = None
        try:
            with open(chart_path, 'rb') as image_file:
                chart_base64 = f"data:image/png;base64,{base64.b64encode(image_file.read()).decode('utf-8')}"
        except Exception as e:
            logging.warning(f"无法生成更新后图表 {chart_path} 的Base64预览: {e}")

        return jsonify({
            "status": "success",
            "message": f"已更新图表，筛选条件为通话次数 > {call_num}",
            "chart_id": chart_filename,
            "chart_data": chart_base64
        })
    except Exception as e:
        logging.exception(f"更新图表时发生意外错误")
        return jsonify({"status": "error", "message": f"服务器内部错误: {str(e)}"}), 500

@call_records_bp.route('/delete-file/<file_id>', methods=['DELETE']) 
def delete_file_rest(file_id):
    """
    API端点：根据文件ID删除生成的报告或图表文件 (RESTful)。
    """
    if not file_id:
        return jsonify({"status": "error", "message": "未提供文件ID"}), 400

    if '..' in file_id or file_id.startswith('/'):
         return jsonify({"status": "error", "message": "无效的文件ID"}), 400

    file_path = os.path.join(RESULT_FOLDER, file_id)
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "文件未找到"}), 404

    try:
        os.remove(file_path)
        logging.info(f"文件已删除: {file_path}")
        return jsonify({"status": "success", "message": "文件已删除"})
    except Exception as e:
        logging.exception(f"删除文件 {file_id} 时发生错误")
        return jsonify({"status": "error", "message": f"删除文件时出错: {str(e)}"}), 500

@call_records_bp.route('/health', methods=['GET'])
def health_check():
    """API健康检查端点。"""
    return jsonify({
        "status": "ok",
        "module": "call_records",
        "version": "1.1.0",
        "timestamp": datetime.now().isoformat()
    })