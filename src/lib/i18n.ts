import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
    en: {
        translation: {
            "app": {
                "title": "Chat2Excel",
            },
            "nav": {
                "data": "Data",
                "chat": "Chat",
                "settings": "Settings"
            },
            "data": {
                "assets": "Data Assets",
                "no_tables": "No tables found. Import a file to get started.",
                "import": "Import File",
                "import_title": "Import Data",
                "preview": "Data Preview",
                "schema": "Schema & Notes",
                "delete_confirm": "Are you sure you want to delete table \"{{name}}\"? This action cannot be undone.",
                "add_desc": "Add a table description to help AI analysis...",
                "use_desc": "Use descriptions to help the AI understand your data",
                "table_structure": "Table Structure",
                "define_logic": "Define business meanings for AI comprehension",
                "col_name": "Column Name",
                "col_type": "Type",
                "col_desc": "Description / Interpretation",
                "action": "Action",
                "invalid_file": "Invalid file type. Please select .csv or .xlsx",
                "path_error": "Could not get file path",
                "import_failed": "Import failed",
                "drag_desc": "Click or drag file here to upload",
                "supported_formats": "Supports CSV, XLSX, XLS",
                "importing": "Importing data...",
                "privacy_note": "Your data is stored locally and never uploaded to our servers",
                "fetch_failed": "Failed to fetch data",
                "select_table": "Select a table to view details",
                "no_desc": "No description provided",
                "empty": "No data in this table",
                "error": "Error"
            },
            "chat": {
                "new_session": "New session",
                "new_chat": "New chat",
                "local_storage": "Local Storage",
                "placeholder": "Ask a question about your data...",
                "no_context": "No context",
                "tables_count": "{{count}} Tables",
                "data_context": "Data Context",
                "select_all": "Select All",
                "no_data_imported": "No data imported yet",
                "press_enter": "Press Enter to send, Shift + Enter for new line",
                "footer_note": "Messages are processed locally by your selected AI model",
                "config_error": "Please configure your API Key and Model in Settings first.",
                "thinking": "Thinking...",
                "export_excel": "Export to Excel",
                "download_image": "Download Image",
                "table_preview": "Table Preview",
                "no_messages": "No messages yet. Start analyzing your data!",
                "ai_analyst": "AI Analyst",
                "you": "You",
                "no_model": "No model selected",
                "no_models_configured": "No models configured",
                "send": "send"
            },
            "settings": {
                "title": "Settings",
                "description": "Manage your model configurations and preferences.",
                "model_config": "Model Configuration",
                "model_desc": "Configure LLM endpoints (OpenAI compatible).",
                "model_node": "Model Node #{{index}}",
                "display_name": "Display Name",
                "base_url": "Base URL",
                "api_key": "API Key",
                "model_id": "Model ID",
                "set_active": "Set as Active Model",
                "add_model": "Add Model Node",
                "preferences": "Preferences",
                "system_prompt": "Global System Prompt",
                "system_prompt_desc": "This prompt will be prepended to all your conversations.",
                "theme": "Theme",
                "theme_light": "Light",
                "theme_dark": "Dark",
                "theme_system": "Follow System",
                "language": "Language",
                "save": "Save Settings",
                "new_model": "New Model"
            },
            "common": {
                "loading": "Loading...",
                "save": "Save",
                "delete": "Delete",
                "cancel": "Cancel",
                "error": "Error"
            }
        }
    },
    zh: {
        translation: {
            "app": {
                "title": "Chat2Excel",
            },
            "nav": {
                "data": "数据",
                "chat": "对话",
                "settings": "设置"
            },
            "data": {
                "assets": "数据资产",
                "no_tables": "暂无数据，请导入文件。",
                "import": "导入文件",
                "import_title": "导入数据",
                "preview": "数据预览",
                "schema": "结构与备注",
                "delete_confirm": "确定要删除表格 \"{{name}}\" 吗？此操作无法撤销。",
                "add_desc": "添加表格描述以辅助 AI 分析...",
                "use_desc": "使用描述帮助 AI 理解您的数据",
                "table_structure": "表结构管理",
                "define_logic": "定义业务含义以帮助 AI 理解",
                "col_name": "字段名称",
                "col_type": "类型",
                "col_desc": "说明 / 解释",
                "action": "操作",
                "invalid_file": "不支持的文件格式，请选择 .csv 或 .xlsx",
                "path_error": "无法获取文件路径",
                "import_failed": "导入失败",
                "drag_desc": "点击或拖拽文件到此处上传",
                "supported_formats": "支持 CSV, XLSX, XLS 格式",
                "importing": "正在导入数据...",
                "privacy_note": "您的数据仅存储在本地，绝不会上传到我们的服务器",
                "fetch_failed": "获取数据失败",
                "select_table": "请从侧边栏选择一张表查看详情",
                "no_desc": "暂无描述",
                "empty": "该表中没有数据",
                "error": "错误",
                "send": "发送",
            },
            "chat": {
                "new_session": "开启新会话",
                "new_chat": "开启新对话",
                "local_storage": "本地存储",
                "placeholder": "关于数据，你想问点什么？",
                "no_context": "未选上下文",
                "tables_count": "{{count}} 张表",
                "data_context": "数据上下文",
                "select_all": "全选",
                "no_data_imported": "尚未导入数据",
                "press_enter": "按 Enter 发送，Shift + Enter 换行",
                "footer_note": "消息正由您选择的 AI 模型在本地进行处理",
                "config_error": "请先在设置中配置您的 API Key 和模型。",
                "thinking": "思考中...",
                "export_excel": "导出到 Excel",
                "download_image": "下载图片",
                "table_preview": "表格预览",
                "no_messages": "暂无消息。开始分析您的数据吧！",
                "ai_analyst": "AI 分析师",
                "you": "您",
                "no_model": "尚未选模型",
                "no_models_configured": "未配置模型"
            },
            "settings": {
                "title": "设置",
                "description": "管理您的模型配置和个人偏好。",
                "model_config": "模型配置",
                "model_desc": "配置 LLM 终端（兼容 OpenAI 协议）。",
                "model_node": "模型节点 #{{index}}",
                "display_name": "显示名称",
                "base_url": "接口地址 (Base URL)",
                "api_key": "API 密钥 (API Key)",
                "model_id": "模型 ID (Model ID)",
                "set_active": "设为当前活跃模型",
                "add_model": "添加模型节点",
                "preferences": "通用偏好",
                "system_prompt": "全局系统提示词 (System Prompt)",
                "system_prompt_desc": "此提示词将作为所有对话的基础上下文。",
                "theme": "主题模式",
                "theme_light": "浅色",
                "theme_dark": "深色",
                "theme_system": "跟随系统",
                "language": "语言设置",
                "save": "保存设置",
                "new_model": "新模型"
            },
            "common": {
                "loading": "加载中...",
                "save": "保存",
                "delete": "删除",
                "cancel": "取消",
                "error": "错误"
            }
        }
    }
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false,
        },
    });

const syncLanguage = async () => {
    if (window.api?.settings) {
        const savedLang = await window.api.settings.get('language');
        if (savedLang) {
            i18n.changeLanguage(savedLang);
        }
    }
};

syncLanguage();

export default i18n;
