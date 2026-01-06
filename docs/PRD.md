
**项目名称：** Chat2Excel (Local-First Chat BI)
**文档状态：** 评审通过 / 待开发 
**核心理念：** 本地优先、隐私安全、操作确定、数据可靠
**目标用户：** 企业内非技术背景（财务、人力、销售等）、对数据安全敏感、无 BI 工具使用经验的用户。

---

## 1. 设计原则 (Design Principles)

针对 B 端非技术用户，本产品遵循以下两大核心原则：

- **操作的确定性 (Certainty):**
    
    - 所有交互必须显性化，减少用户的记忆负担和误操作风险。
        
    - 关键操作（如删除）必须有二次确认。
        
    - 系统状态（思考中、查询中、渲染中）必须实时可见。
        
- **数据的可靠性 (Reliability):**
    
    - **所见即所得：** 图表必须配备源数据表格，确保数据可解释、可核对。
        
    - **一致性：** 只要数据源不变，相同的自然语言问题应得到稳定的结果。
        
    - **边界控制：** 明确的数据量限制（1w行），避免系统崩溃导致的不信任。
        

---

## 2. 系统架构 (System Architecture)

### 2.1 技术选型

- **App Shell:** Electron (Vite)
    
- **Frontend:** React + TypeScript + TailwindCSS + Shadcn/ui
    
- **Database:** DuckDB (Node.js Binding) - _高性能本地分析引擎_
    
- **LLM Integration:** OpenAI SDK (兼容 DeepSeek/Claude 等)
    
- **State Management:** Zustand
    
- **Config Storage:** electron-store (用于存储用户偏好设置)
    

### 2.2 Agentic Tool 架构 (MVP)

采用 "LLM as Brain, Tools as Hands" 的架构模式，为未来扩展打基础。

- **Tools:** 当前版本仅实现 `query_database` 工具。
    
- **限制:** 工具仅具备 `SELECT` 只读权限，严禁执行 `INSERT`, `UPDATE`, `DELETE`, `DROP` 操作。
    
- **调用逻辑:** 全自动模式。LLM 根据用户意图自动判断是否需要调用工具查数。
    

---

## 3. 功能需求说明 (Functional Requirements)

### 3.1 导航与框架

- **一级导航 (Sidebar):**
    
    - **Data:** 数据资产管理。
        
    - **Chat:** 智能分析对话。
        
    - **Settings:** 底部设置入口。
        

### 3.2 Data 模块：数据管理与语义层

- **文件导入:**
    
    - **支持格式:** `.xls`, `.xlsx`, `.csv`。
        
    - **交互:** 点击“导入”弹出模态框（Modal）。
        
    - **模态框文案:**
        
        > "请将 Excel 或 CSV 文件拖拽至此处，或点击选择文件。" "🔒 安全承诺：您的数据仅存储在本地 DuckDB 数据库中，不会上传至任何云端服务器。"
        
- **数据预览与语义增强 (Semantic Layer):**
    
    - 用户点击左侧表名，右侧展示“表详情页”。
        
    - **表备注:** 允许用户输入业务背景（如“2024 Q1 华东区不含税销售表”）。
        
    - **列管理:** 展示列名、类型、预览数据。提供**“列备注/别名”**输入框（如将 `c_id` 备注为 `客户ID`）。
        
    - _价值:_ 这些备注将作为 System Prompt 的一部分，大幅提升 AI 理解能力。
        

### 3.3 Chat 模块：交互与展示

- **会话管理 (Session Mgmt):**
    
    - **新建:** 列表顶部固定“+ 新建对话”。
        
    - **编辑/删除:** 鼠标**悬浮**在会话名称上时，才显示“重命名（铅笔）”和“删除（垃圾桶）”图标。
        
    - **防误触:** 点击删除时，弹出 AlertDialog：“确定要删除该会话吗？此操作无法恢复。”
        
- **消息发送区 (Input Area):**
    
    - **多行文本输入框:** 支持 Shift+Enter 换行，Enter 发送。
        
    - **选择表 (Context Selector):** 输入框左下角提供“数据源选择”气泡。点击弹出已加载的表格列表（支持 Checkbox 多选），明确告知 AI 本次对话基于哪些数据。
        
    - **选择模型 (Model Selector):** 输入框右下角提供下拉菜单，切换已配置的模型（如 GPT-4o, DeepSeek-V3）。
        
    - **发送提示:** 输入框下方展示灰色小字 _"Press Enter to send, Shift + Enter for new line"_。
        
- **对话流 (Stream Chat):**
    
    - **混合排版:** 支持 `Text` + `Thinking` + `Chart` + `Table` 的组合输出。
        
    - **思考过程 (Thinking Process):**
        
        - 针对推理模型（如 DeepSeek-R1），识别 `<think>` 标签。
            
        - UI 表现：独立的灰色折叠区域，默认折叠，显示“AI 正在深度思考...”，点击可展开查看详细思维链。
            
        - **渐进式加载:** 思考过程必须流式输出，不能阻塞后续内容的渲染。
            
- **可视化与数据表格:**
    
    - **Chart:** ECharts 渲染。右上角提供“保存为图片 (PNG)”按钮。
        
    - **Table (数据源):**
        
        - **位置:** 紧随图表下方，或作为单独回答出现。
            
        - **分页逻辑:** 采用**逻辑全量，物理分页**。
            
        - **限制:** 单次查询结果限制最大 **10,000 行**。
            
        - **提示:** 表格右上角显示 Tooltip：“为了性能与稳定性，系统仅展示前 10,000 条数据。”
            
        - **导出:** 表格右上角提供“导出 Excel”按钮，导出当前查询的全量结果。
            

### 3.4 Settings 模块

- **模型配置:** 支持添加多个模型节点（Name, BaseURL, API Key, Model ID）。
    
- **提示词管理 (Global Prompts):**
    
    - 支持配置两类全局提示词：
        
        1. **System Prompt:** 定义角色、输出规范、语气。
            
        2. **SQL Correction Prompt:** 定义当 SQL 执行报错时，自动重试的修正指令。
            
- **主题设置:** 提供 Light / Dark / Follow System 三种模式。
    
- **语言设置 (Language):** 支持 English / 简体中文 切换（默认为 English）。
    

---

## 4. 关键业务流程与 Agent 故事

### 4.1 Agent 故事：数字分析师的一天

> **场景：** 销售总监想知道上个季度哪个产品的利润率异常。
> 
> 1. **感知 (Perception):** 用户输入 "Which product had the lowest profit margin in Q3?" 并勾选了 `sales_2024.xlsx`。
>     
> 2. **规划 (Thinking):** Agent (LLM) 接收到 Prompt。它分析语意，发现需要计算 `(Sales - Cost) / Sales`，并且时间范围是 Q3。它查看了数据字典，发现列名分别是 `total_amt` 和 `cost_amt`。
>     
> 3. **行动 (Action - Tool Use):** Agent 决定不凭空瞎猜，而是调用 `query_database` 工具。它生成了一段 SQL：`SELECT product_name, (total_amt - cost_amt)/total_amt as margin FROM sales_2024 WHERE quarter = 'Q3' ORDER BY margin ASC LIMIT 5`。
>     
> 4. **执行 (Execution):** Electron 主进程拦截到工具调用，让 DuckDB 执行该 SQL。
>     
> 5. **反馈 (Observation):** DuckDB 返回了数据 `[{product: "Old Widget", margin: 0.02}, ...]`.
>     
> 6. **表达 (Response):** Agent 结合数据，用自然语言回复用户：“Analysis shows that 'Old Widget' had the lowest margin at 2%.” 并自动让前端渲染了一个柱状图进行对比。
>     

### 4.2 业务流程图 (Mermaid Sequence Diagram)

代码段

```
sequenceDiagram
    participant User as 用户 (User)
    participant UI as 前端界面 (React)
    participant Main as 主进程 (Electron Controller)
    participant LLM as 大语言模型 (Brain)
    participant DuckDB as 本地数据库 (Hands)

    User->>UI: 输入 "Q3 利润率最低的产品?" (选表: Sales)
    UI->>LLM: 发送 System Prompt + Schema + 用户问题
    loop 思考与工具调用 (Agent Loop)
        LLM-->>UI: (可选) 流式输出 <think> 思考过程
        LLM->>UI: 返回 Tool Call (function: query_database, args: SQL)
        UI->>Main: IPC 发送执行 SQL 请求
        Main->>DuckDB: 执行 SQL (Select ...)
        DuckDB-->>Main: 返回查询结果 (JSON)
        Main-->>UI: 返回 Data Payload
        UI->>LLM: 将查询结果追加到对话上下文 (Tool Output)
    end
    LLM->>UI: 生成最终自然语言回复 + 图表配置
    UI->>User: 渲染: 思考折叠块 + 文本结论 + ECharts图表 + 数据表格
```

### 4.3 异常处理策略

- **SQL 错误:** 重试失败后，直接在对话框展示红色错误卡片：“无法执行查询，原因：[Error Log]”，并建议用户检查字段名。
    
- **数据为空:** 若 SQL 执行成功但结果为 0 行，AI 应回复：“查询成功，但未找到符合条件的数据。”，而不是显示空图表。
    
- **格式不支持:** 若用户导入 Excel/CSV 以外的文件，需给出明确提示。
    
- **取数失败:** AI 生成 SQL 报错时，界面显示“AI 正在尝试修复”并进行自动重试；若依然失败，展示错误信息。
    

---

## 5. UI 设计规范 (Design Specs)

- **主题:** TailwindCSS + Shadcn/ui (Zinc/Slate theme)。
    
- **字体:** Inter (英文) + Noto Sans SC (中文) - 确保数字显示清晰。
    
- **Loading 态:**
    
    - AI 思考时：Thinking Accordion 闪烁。
        
    - SQL 查询时：在对话气泡底部显示微小的 Spinner 和文字 "Querying local database..."。
        
- **Icon:** 使用 Lucide React 图标库。
    
- **响应式:** 适配不同尺寸的电脑屏幕，侧边栏支持收起以扩大分析区域。
    

---

## 6. 数据存储方案

- **原始数据:** 存储在用户本地 AppData 目录下的 `.duckdb` 文件中。
    
- **元数据 (Metadata):** 使用 SQLite 或 DuckDB 自身的 Metadata 表存储用户设置的“表备注”和“列别名”。
    
    - _Schema:_ `table_meta (table_name, description)`, `column_meta (table_name, col_name, alias, description)`
        
- **对话历史:** 存储在用户本地 AppData 目录下的 `sessions.json` 或 SQLite 中。
    
- **系统设置:** 使用 `electron-store` 存储简单的 Key-Value 配置（如 `theme`, `language`, `models_config`）。
    

---

### 给开发团队的补充说明 (Notes for Dev)

1. **工具解析:** 请务必做好对 `<think>` 标签的正则解析，将其与正文内容分离，避免渲染混乱。
    
2. **IPC 优化:** 虽然限制了 1w 行，但传输 1w 行 JSON 对象仍需注意序列化性能。建议在主进程压缩数据或使用二进制流传输。
    
3. **安全性:** 在主进程执行 SQL 前，务必通过正则简单校验，拦截 `DROP`, `DELETE`, `UPDATE` 等关键词，作为 Prompt 之外的第二道防线。