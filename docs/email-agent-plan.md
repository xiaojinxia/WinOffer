# WinOffer 求职邮件 Agent 详细接入方案

日期：2026-09-25。状态：首版代码已实施，真实服务联调待本地凭据。第 1—27 节保留设计基线，第 28 节记录实际交付、差异与验证。

## 1. 已确认的决策

- 模型服务：DeepSeek。
- 邮箱：QQ 邮箱。
- 更新方式：生成待确认建议，用户确认后才更新节点。
- 当前工作：只完善方案，不修改应用代码、数据库结构，不读取真实邮箱或调用模型。

产品目标：把招聘邮件中的安排和反馈转成有原文依据的投递更新建议，减少查邮件、辨认投递、复制时间和手动更新节点的重复操作。

任何模型结果都不能直接修改投递；“高置信度”也不例外。下文的首版范围、数量限制、保留周期均为建议默认值，可在评审时调整。

## 2. 首版范围与分期边界

首个核心发布点包含：单个 QQ 邮箱接入、主动同步近期邮件、DeepSeek 结构化分析、匹配现有投递、待确认更新、修改建议、冲突检查、应用记录和邮件来源追溯。

随后加入自然语言任务与本地回复草稿，使用户可以说“整理本周招聘邮件，列出需要我确认的安排”。QQ 草稿箱保存和手动发信另一个阶段交付；不能把复制草稿称为已发送。

首版建议不做：后台定时轮询、多邮箱、附件内容解析、自动投递、自动接受/拒绝 Offer、未经确认的节点更新。它们不影响核心闭环，可以后续单独扩展。

## 3. 一次完整操作如何完成

1. 配置 DeepSeek API Key、QQ 邮箱地址和授权码，分别检查模型与邮箱连接。
2. 点击“同步招聘邮件”。首次建议检查最近 30 天，后续读取新增邮件，包含已读邮件，不改变已读状态。
3. 页面显示同步与分析进度，以及待确认、待关联、失败的数量。
4. 打开建议，检查目标投递、原值、新值、原文证据以及连带变化。
5. 目标不明确时选择投递或节点；字段有误时编辑建议，重新生成预览。
6. 点击“确认更新”，服务端检查版本并一次性保存业务变化、审计和建议状态。
7. 原有投递进度线更新，历史中能查看来源邮件和实际变更。
8. 如需回复，另行生成草稿。确认节点更新不等于确认发信。

示例：邮件明确写“Java 后端二面，9 月 28 日 14:00，会议链接……”。系统为对应投递生成二面待完成及安排信息的建议；确认前，原投递不变化。正文没有写一面通过时，不把已有一面结果擅自改为通过。

## 4. 页面如何融合

### 4.1 保留现有工作台

保留列表、筛选、排序、进度线和手动编辑。增加“邮件助手 · 3”入口，其中数字表示待确认数量。未配置邮箱时提供配置引导，本地手动功能照常可用。

邮件工作区建议独立展示，保证原文与变更有足够空间；不要把整个主页面改成聊天框。

### 4.2 邮件工作区结构

| 区域 | 内容 |
| --- | --- |
| 顶部 | 邮箱状态、上次同步时间、日期范围、同步按钮 |
| 待确认 | 已匹配并通过校验的更新建议 |
| 待处理 | 未匹配、轮次不清、信息缺失、邮件冲突 |
| 已处理 | 已应用、忽略、无变化、被新通知替代 |
| 任务详情 | 同步/分析进度、失败原因、重试入口 |

“已处理”是应用内状态，不代表邮箱中被标记已读。关闭页面、重启服务后，未处理建议仍保留。

### 4.3 更新预览的必要内容

- 目标：公司、岗位、招聘批次、申请编号（有则显示）。
- 来源：主题、发件人地址、邮件时间、支持本次更新的原文，可展开纯文本正文。
- 匹配理由：例如申请编号一致、公司和岗位一致、用户确认过同一线程；不用未经校准的百分比替代解释。
- 主变更：节点名称与每个字段的当前值、建议值，区分新增、修改和清空。
- 连带变更：前序节点跳过、简历状态推进、日期清空、Offer 决策重置等。
- 不确定项：轮次、年份、时区、多个申请等；必要信息未解决时禁用确认。
- 操作：确认更新、修改建议、忽略。首版逐条确认，不默认批量应用。

示意：

    某公司 · Java 后端 · 秋招
    来源：二面邀请 / HR 邮箱 / 收到时间
    二面状态：未开始 → 待完成
    安排日期：空 → 2026-09-28
    具体时间：空 → 14:00（中国标准时间）
    会议链接：空 → 邮件中的链接
    连带变化：根据当前流程规则列出，不隐藏
    [确认更新] [修改建议] [忽略]

### 4.4 原有详情与历史

投递详情增加“关联邮件”，历史记录“根据邮件更新了二面安排”，可查看来源摘要及差异。服务器上的邮件被删除后，已保留的证据片段仍可查看。

不借用现有“撤销流程调整”实现通用撤销。首版用户可手动纠正；后续如增加恢复前值，需要检查之后没有新修改，避免覆盖后续进度。

## 5. 邮件同步与去重

### 5.1 范围和进度

首版建议一个邮箱、INBOX、首次最近 30 天，可扩大日期范围。建议每批读取 50 封，单个分析任务最多 100 封，界面显示剩余待处理量，不能让用户误以为已分析全部邮件。

只按本地已保存邮件推进同步游标，分析失败不阻塞邮件入库；“同步成功”与“分析成功”分别记录。支持重新分析某封邮件，无需重复读取整箱。

### 5.2 稳定标识

使用账号 + 文件夹 + UIDVALIDITY + UID 定位，不使用列表序号。Message-ID 和内容摘要只作线程关联与辅助去重，不能单独作为绝对唯一键。

UIDVALIDITY 变化后重建游标，在限定时间范围重新扫描并复核重复邮件，不继续使用旧 UID。重复同步不重复入库；同一邮件的同一业务事件不重复生成可执行建议。

一封邮件可以有多个事件，按事件指纹区分。重新分析保留分析版本，可替代未应用建议，不自动再次执行已应用事件。

### 5.3 正文与候选筛选

解析中文主题与正文；优先纯文本，只有 HTML 时转换为文本。不执行脚本，不加载远程图片，不自动访问链接。首版附件只展示文件名，不解析、下载或执行内容。

超长正文应显示截断标记，关键事实不完整时进入待处理。时间只写在附件中时不能猜测。

先用本地规则结合招聘关键词、公司、岗位、既有关联筛选候选；不把规则未命中作为永久排除。提供“其他邮件”及手动分析入口，避免非标准招聘邮件无法处理。

云端分析前说明：选中邮件正文及必要投递摘要会发送给 DeepSeek；不默认上传整箱、完整投递历史或凭据。

## 6. 事件提取与节点映射

先由模型提取事实，再由服务端生成受限业务建议。结构化事件包含类型、公司、岗位、申请编号、阶段/轮次、时间、时区、地点、链接、证据、缺失项和冲突项。

关键字段必须有正文依据，服务端检查引用片段确实存在。原文存在不代表语义必定正确，因此仍需用户确认。

| 邮件事件 | 建议操作 | 不得推断的内容 |
| --- | --- | --- |
| 投递回执 | 关联邮件，必要时建议补备注 | 不等于简历通过，不重复创建投递 |
| 测评/笔试邀请 | 对应节点待完成，填写安排/截止信息 | 不把开始时间当截止时间 |
| 明确轮次面试邀请 | 指定轮次待完成，填写时间地点链接 | 不擅自改变已有前轮结果 |
| 不明确轮次的邀请 | 提取安排，等待用户选节点 | 不默认一面或下一个未开始节点 |
| 明确通过通知 | 对应阶段已通过 | 泛泛的“流程推进”不等于通过 |
| 明确拒绝通知 | 对应阶段未通过 | 不标记全部阶段失败；阶段不明先选择 |
| 改期 | 修改对应安排，显示新旧值 | 历史邮件不能直接覆盖新安排 |
| 取消面试 | 待处理，用户选择后续状态 | 不等于淘汰，现有模型无取消状态 |
| 正式 Offer | Offer 节点已通过，保留关键原文 | 意向沟通不等于 Offer，不代为接受/拒绝 |
| 催回复/补资料 | 展示提醒，可生成草稿 | 不强行更改招聘阶段 |

一封邮件同时明确笔试通过和一面邀请时，生成同一建议包内两个操作，完整预览并在一次事务中执行。涉及多条投递则分别处理。

### 6.1 时间和缺失字段

- 只写日期不补 00:00，只写下午不编造小时。
- 没有年份时显示推断依据并要求用户确认，不静默用当前年。
- 相对时间根据邮件时间及上下文解析，不以同步时间为基准；转发、引用导致基准不清时要求补充。
- 默认显示中国标准时间；其他时区明确展示原时间和转换结果。现有节点无时区字段，首版建议存中国标准时间，备注保留原时区。
- 邮件没有提到的字段保持原值，不用空值覆盖；明确清空时在预览中标识。
- 同时有考试开始与截止时间时，现有单日期界面表达不足。首版建议主字段保存截止时间，备注保留完整区间，预览说明；若要两个独立字段，作为单独模型/UI 扩展实施。

## 7. 如何匹配投递

1. 优先用户已确认的具体邮件线程关联，或公司范围内唯一的申请编号。新邮件出现不同岗位/编号时仍要复核。
2. 结合公司别名、岗位、部门、批次、时间、正文生成候选。
3. 发件人域名只作辅助。招聘平台服务多家公司，同一 HR 可能负责多个岗位，不永久绑定为唯一申请。
4. 唯一合理候选可预选并展示依据；多个候选不得默认选第一个。
5. 找不到时允许选择现有投递，或进入现有新建投递表单，保存后返回继续关联；不自动创建。
6. 已结束投递、已删除节点、已有更晚结果、已接受 Offer 时显示冲突，不隐式重开流程或回退进度。
7. 公司/岗位别名随用户纠正积累，只辅助候选排序，不把同公司邮件全部归在一条记录下。

匹配状态使用“已关联、建议候选、需要选择”，不依赖模型自报置信度决定执行权限。

## 8. 建议状态、预览和确认

建议状态：待补充、待确认、已应用、已忽略、已失效。失效原因包括记录变化、目标删除、被更新通知替代。任务运行/失败状态单独管理。

### 8.1 服务端生成完整预览

读取最新投递快照，复用 shared/model.js 的 applyChange 演算操作包，生成完整业务差异。演算不写数据库。

用户修改目标、节点或字段时，服务端再次校验和演算，产生新的预览版本，旧确认标识失效。前端不能直接提交任意模型补丁或 SQL。

预览内容由服务端保存。确认请求携带预览标识与版本，不能附带未经审阅的任意操作内容。

### 8.2 确认事务

同一 SQLite 事务完成：

1. 检查建议仍待确认且预览版本一致。
2. 检查当前 revision 与预览一致。首版沿用全局版本；其他投递变化也要求刷新预览。
3. 再次校验并计算业务结果。
4. 保存投递、邮件关联、来源审计和实际前后差异。
5. 标记已应用，更新 revision。

任何一步失败全部回滚。重复确认返回首次成功结果，不重复写入或追加历史。上一条建议应用后，同一投递其他建议必须重新预览；首版不做跨投递批量提交。

### 8.3 必须展示的现有规则

- 后续节点被设置进度时，前序未开始节点可能自动跳过（简历除外）。
- 简历仍待筛选且后续已有进度时，简历可能自动通过。
- 待完成节点变成其他状态时，会清空安排日期和时间。
- Offer 节点不再为已通过时，Offer 决策可能重置。

这些变化必须来自同一业务计算，前端不再另写一套猜测规则。确认预览里不能只显示主节点变化。

### 8.4 历史通知和新通知

后收到不一定代表更晚的安排，需结合正文、转发引用和改期关系。明确被新通知取代的未应用建议可以失效；不能判断时并排展示两封邮件，由用户选择。已应用结果不因重新分析自动回滚。

## 9. Agent 执行器与工具权限

按钮和自然语言任务使用同一业务服务。模型可分多轮查询信息、补充候选、生成建议，但执行边界由代码控制。

| 工具 | 职责 |
| --- | --- |
| search_applications | 查询必要的投递摘要 |
| list_emails / get_email | 读取选定范围内邮件及正文 |
| propose_update | 生成经过校验的待确认建议 |
| list_proposals | 查询建议状态，汇总待办 |
| draft_reply | 生成本地回复草稿 |

确认写入接口不注册给模型，发送接口也不暴露给模型。邮件内容是外部数据，不能增加工具权限；模型没有文件读取、凭据读取、命令执行能力。

建议单任务最多 8 轮模型调用、20 次工具调用、5 分钟总时限，实施时按测试调整。达到上限保存已完成结果，显示部分完成，不无限重试。

同一邮箱同一时间只运行一个同步任务。取消停止后续工作，已保存邮件和建议保留；重启后把中断任务标为中断，可从持久化进度恢复。程序关闭后不继续轮询。

显示实际执行步骤、失败原因及用量（接口提供时），不展示模型内部推理。业务成功以服务端保存状态为准，不能仅凭模型说“已更新”显示成功。

## 10. 回复能力分期

首版草稿在本地生成和编辑，支持复制，默认不访问 QQ 草稿箱、不发送。回复可引用原邮件，但不能替用户编造承诺、薪资决定或可参加时间。

后续保存草稿时识别 QQ 的实际草稿箱，并检查服务端返回结果。发信前展示收件人、主题、正文，用户确认的内容与发送内容绑定。

SMTP 结果不明时显示“待核实”，不自动重发。生成、保存至邮箱、已发送为不同状态。连接检查不发送测试邮件。

## 11. 技术架构与上游项目取舍

建议路径：原生前端 → 本地 Node.js HTTP 服务 → Agent 执行器 → DeepSeek 适配器 / 邮件适配器 / 投递工具 → SQLite。

保留现有 Node.js 主服务与前端；新增成熟的 IMAP/MIME 依赖，SMTP 在发信阶段加入。DeepSeek 模型名可配置，实施前核验官方工具调用格式及可用模型，不在此固定未经验证的默认名称。

邮件功能会改变当前“零第三方依赖”的安装方式，需要更新启动文档并验证 Windows/macOS。无需为编排引入完整 Python/LangChain 栈。

### 11.1 与 email-agent-mcp 的关系

参考仓库：https://github.com/wyniot/email-agent-mcp

已静态阅读 README、mcp_server.py、tools.py、agent.py、config.py、requirements.txt、.mcp.json，尚未运行上游。

上游提供 Python FastMCP stdio 邮件工具，但求职匹配和 WinOffer 业务规则需要另写。其未读邮件范围、按列表索引回复、正文详情能力、连接错误处理、草稿结果检查、stdout 日志、默认模拟模式和依赖声明均需要适配；发送限制主要由提示词表达，也不符合本方案权限隔离。

建议借鉴能力划分，独立实现适合 WinOffer 的邮件适配器，不原样嵌入。Agent 可以通过应用内部工具调用执行任务，首版不必引入 MCP 协议。未来需要外部客户端访问 WinOffer 时，再为同一工具服务提供 MCP 封装。

如果后来复用源码，需核对许可证并保留必要声明；目前只作为参考。

### 11.2 建议模块

| 模块 | 职责 |
| --- | --- |
| server/agent/config.js | 配置、凭据状态、连接检查 |
| server/agent/mail.js | QQ IMAP、稳定标识、正文解析 |
| server/agent/deepseek.js | 模型请求、工具消息、超时、错误脱敏 |
| server/agent/runner.js | 多轮执行、任务限额、取消与恢复 |
| server/agent/extraction.js | 事件及证据校验 |
| server/agent/matching.js | 匹配、人工关联和冲突判断 |
| server/agent/proposals.js | 预览、确认、版本和幂等 |
| server/agent/store.js | 邮件与任务持久化，共享业务写入事务 |
| public/agent.js / agent-views.js | 工作区、原文、预览与编辑 |

建议接口：GET /api/agent/status；POST /api/agent/test-connection；POST /api/agent/sync；POST /api/agent/tasks；GET /api/agent/tasks/:id；POST /api/agent/tasks/:id/cancel；GET /api/agent/emails；GET /api/agent/proposals；POST /api/agent/proposals/:id/preview、confirm、ignore；POST /api/agent/drafts。

长任务立即返回任务 ID，前端查询进度，不受现有 30 秒普通请求超时约束。继续采用本机监听和 Host/Origin 校验，不开放外网服务。

## 12. 数据模型与备份

建议同一 SQLite 库新增表，通过显式迁移升级，原 applications 文档尽量兼容。建议与业务变更共用事务，不能把“节点已保存”和“建议已应用”拆成两个可能部分失败的事务。

| 表 | 核心内容 |
| --- | --- |
| mail_accounts | 账号标识、地址、同步游标 |
| mail_messages | 稳定标识、主题、发件人、时间、正文、截断标志、摘要 |
| mail_links | 具体邮件/线程与投递关联、用户确认依据 |
| agent_tasks | 状态、进度、游标、错误、调用次数与用量 |
| mail_events | 结构化事件、证据、版本和去重标识 |
| agent_proposals | 操作包、revision、预览版本、状态与失效原因 |
| agent_audit | 来源摘要、建议 ID、目标、前后差异、确认和应用时间 |
| reply_drafts | 本地正文、原邮件、编辑时间、保存/发送状态 |

升级前建立完整数据库安全备份；现有投递 JSON 不是整个新数据库备份。

现有投递备份继续保存业务数据及兼容的必要来源摘要，不包含凭据、整封邮件缓存或任务。界面说明备份范围；完整 Agent 备份后续另做，不静默改变旧格式。

恢复投递 JSON 后，旧待确认预览全部失效，检查关联目标是否还存在，不自动重放历史邮件更新。保留已应用事件去重记录，允许用户主动重新分析恢复后的差异。删除投递时处理关联和待确认建议，不留下可执行的悬空操作。

## 13. 配置、数据流与保留

首版建议用 .env.local 保存 DEEPSEEK_API_KEY、DEEPSEEK_MODEL、QQ_EMAIL、QQ_AUTH_CODE，加入 .gitignore，仅服务端读取。前端显示是否配置，不回传原文。它是本地明文配置，不能称为已加密存储；后续界面保存优先考虑系统凭据库。

QQ 登录密码不是授权码。QQ 服务地址由适配器配置，DeepSeek 端点默认限制官方服务，邮件或模型不能改变凭据发送目的地。

首次启用清楚说明：本机读取 QQ 邮件，选中正文及必要的投递摘要会发送给 DeepSeek。不能承诺所有数据始终只在本机。

正文缓存建议保留 90 天；待确认项依赖的正文不自动清理，已应用项保留最小证据和来源摘要。用户可清理缓存，清理不删除投递记录。日志不保存凭据、整份模型请求或完整邮箱正文。

## 14. 失败处理

| 情况 | 系统行为 |
| --- | --- |
| QQ 授权失败 | 明确提示连接失败，不显示无邮件，不覆盖旧数据 |
| 模型认证/余额问题 | 邮件已同步，分析未完成；修复后单独重试 |
| 模型超时/限流 | 有界重试、退避，保留已完成建议 |
| 返回结构不合法 | 拒绝进入可执行建议，转待处理或分析失败 |
| 用户已手动编辑 | 预览过期，重新检查，禁止覆盖 |
| 重复邮件/事件 | 显示已处理或无变化，不追加相同历史 |
| 程序中断 | 标记任务中断，按保存进度恢复 |
| 磁盘或事务失败 | 整体回滚，不能只改建议状态或只改节点 |
| 邮件包含诱导指令 | 当作正文，不能访问凭据、文件、执行确认或发信 |

正文和模型输出安全转义，链接仅允许 http/https，不自动打开。真实模型和邮箱联调与模拟测试明确区分。

## 15. 实施阶段与交付标准

### A. 邮箱接入

交付配置模板、连接检查、同步、正文列表、稳定标识、增量、去重与进度。标准：已读未读都能读取，不改变已读；错误不伪装无邮件；不写节点。

### B. 分析与匹配

交付 DeepSeek 接入、事件提取、证据、候选与人工关联。标准：多岗位必须选择，轮次不明不猜，未知时间不补零，附件信息不编造。

### C. 待确认更新闭环（首个核心发布点）

交付建议列表、编辑、完整预览、确认事务、幂等、冲突与来源历史。标准：确认前投递不变；预览与执行一致；连带变化可见；重启建议仍在；重复确认只应用一次；失败不留半完成结果。

### D. 对话任务与本地草稿

交付多轮工具执行、汇总、任务取消、操作记录与草稿。标准：能从查询到建议完成任务，不能绕过确认，界面区分已建议、已应用和已回复。

### E. 可选邮箱写操作

交付保存 QQ 草稿、用户确认发送、结果核实；不作为 C 的前置条件。

各阶段使用隔离数据库测试，运行相关自动化测试和现有回归检查。界面检查桌面、小屏、键盘、长正文、空状态、等待、失败和冲突。真实联调配置凭据后进行，发信由用户明确触发。

## 16. 必测场景

1. 单一匹配的一面邀请：确认后写安排，来源可查。
2. 同公司两岗位：必须选对目标，不能取第一条。
3. 一封邮件多个事件：操作包全成功或全回滚。
4. 未写时间/见附件：不编造时间。
5. 待完成改已通过：预览展示时间清空及全部连带变化。
6. 手动更新发生在预览之后：返回冲突，不覆盖。
7. 新改期与旧通知：旧建议不能无提示继续执行。
8. 重复同步、重复确认、确认响应丢失后重试：只有一次业务更新。
9. 已结束投递或节点删除：不隐式恢复或新建流程。
10. HTML 脚本、远程图片、正文指令：不执行、不扩大权限。
11. QQ 与模型分别失败：错误定位正确，已完成工作不丢。
12. 恢复旧 JSON：待确认操作失效，手动功能仍正常。
13. 事务中途失败：投递、审计和建议状态一起回滚。
14. 模型声称已更新但没有确认：界面仍显示待确认。

## 17. 评审时可调整的默认项

目前已确定 DeepSeek、QQ 邮箱、待确认更新。待评审的是首次 30 天、每任务 100 封、单账号、正文缓存 90 天、暂不解析附件、本地草稿先于发信，以及考试时间区间的表示方式。

实施时再核验 DeepSeek 模型与官方接口、QQ 授权配置、依赖选择及版本。现在不需要在聊天中提供 token。本轮只有设计文档更新，进入实施前仍等待用户明确指令。

---

## 18. 开发基线与明确的实现决策

本节起为开发设计，细化前面的产品方案。第 15 节是功能分期，本节后任务清单是实际编码顺序：先通过模拟邮件完成确认闭环，再接真实邮箱和模型。

依据当前代码：Store 使用单个 DatabaseSync 连接、全局 revision 与 BEGIN IMMEDIATE；applications 是带 JSON 校验的文档表。applyChange 会同时计算节点与历史。HTTP 服务已有本机来源检查，前端普通请求超时为 30 秒。

确定以下实现边界：

1. 保留一个数据库连接所有者 Store。Agent repository 接收该连接和事务上下文，不自行打开写连接、不嵌套事务。
2. 投递写入仍只走 shared/model.js 业务规则；新增共享的操作包演算与差异函数，不复制规则。
3. 事务内不执行网络请求、模型调用或异步等待。外部读取与分析在事务外完成。
4. 邮件同步、任务进度、预览生成不更新投递 revision；只有投递业务变化更新它，避免每次进度轮询使全部预览失效。
5. Agent 元数据使用自身 version 字段做并发校验。确认操作在同一事务内检查两类版本。
6. 无配置不加载邮箱连接、不启动任务；手动工作台继续可用。模拟模式只能显式启用，在响应与界面中标注，不能在连接失败后偷偷切换为模拟成功。
7. 内部工具服务先行，MCP 封装不在首版开发清单内。

### 18.1 依赖选择

- IMAP：选择 ImapFlow；使用只读 mailbox lock 和 UID 操作，关闭原始协议日志。[官方 API](https://imapflow.com/docs/api/imapflow-client/)
- MIME：选择 mailparser，优先流式 MailParser；不把附件整体缓存在内存，附件流应及时释放。HTML 输出不可直接信任或注入页面。[官方文档](https://nodemailer.com/extras/mailparser)
- DeepSeek：使用 Node 内置 fetch，通过独立适配器转换工具消息；不引入通用 Agent 框架。
- SMTP：阶段 E 再加入 Nodemailer，不提前提供发送入口。
- 校验：沿用现有显式校验方式；给模型事件和工具参数建立独立严格验证器，拒绝未知字段与不支持的操作。

实施时核验包的 Node 24 兼容性、许可证和具体版本，提交 package-lock.json 并用 npm ci 验证。当前未安装任何依赖。DeepSeek 官方工具调用页本次读取失败，准确请求格式、可用模型和默认模型名列为任务 T06 的编码前核验项，不以旧示例代替验证。

## 19. 数据字典与约束

数据库版本计划由 1 升至 2。新增表使用 STRICT；ID 使用应用生成 UUID 字符串；业务时间用 UTC ISO 文本，显示时转换；邮件原始 Date 另存。UID 与 UIDVALIDITY 用十进制文本存储和 BigInt 比较，避免驱动类型转换问题，禁止文本字典序比较 UID。

以下是字段级设计，开发时据此编写实际 migration。除明确可空字段外均 NOT NULL；JSON 字段增加 json_valid 检查，枚举增加 CHECK。

| 表 | 字段和约束 |
| --- | --- |
| mail_accounts | id PK；address UNIQUE；provider 固定 qq；created_at；enabled 0/1；不存密码 |
| mail_sync_cursors | account_id、folder 复合 PK；uid_validity；last_persisted_uid；scan_state_json；updated_at；账号 FK |
| mail_messages | id PK；account_id FK；folder；uid_validity；uid；message_id 可空；in_reply_to 可空；references_json；sender_json；subject；internal_date；header_date；body_text 可空；body_hash；body_truncated 0/1；attachments_json；parse_state；created_at；UNIQUE(account_id,folder,uid_validity,uid) |
| mail_links | id PK；message_id FK；application_id FK ON DELETE CASCADE；basis 枚举 manual/application_number/thread；created_at；UNIQUE(message_id,application_id) |
| agent_tasks | id PK；account_id FK 可空；kind；state；input_json；progress_json；error_code 可空；safe_error 可空；version；created_at；updated_at；heartbeat_at 可空 |
| agent_task_items | task_id、item_key 复合 PK；message_id FK 可空；state；attempt_count；result_json 可空；error_code 可空；updated_at |
| mail_events | id PK；message_id FK；analysis_version；event_index；event_json；evidence_json；semantic_key；created_at；UNIQUE(message_id,analysis_version,event_index) |
| agent_proposals | id PK；application_id FK ON DELETE SET NULL；state；reason_code 可空；version；current_preview_id 可空；created_at；updated_at |
| proposal_events | proposal_id、event_id 复合 PK；二者 FK；一个操作包可引用多个事件 |
| agent_previews | id PK；proposal_id FK；proposal_version；base_revision；operations_json；before_json；after_business_json；diff_json；content_hash；created_at；不可原地修改 |
| agent_audit | id PK；proposal_id UNIQUE FK；preview_id UNIQUE FK；application_id_snapshot；source_json；before_json；after_json；result_revision；applied_at；历史审计不随投递删除而级联删除 |
| agent_applied_events | event_key PK；audit_id FK；记录已应用事件的业务去重键 |
| reply_drafts | id PK；message_id FK；application_id 可空；to_json；subject；body；version；state；created_at；updated_at；阶段 D 加入 |

索引：messages(account_id,internal_date,id)、tasks(state,created_at)、task_items(task_id,state)、proposals(state,created_at,id)、events(message_id)、links(application_id)、audit(application_id_snapshot,applied_at)。任务增加同账号同步活动状态的部分唯一索引，活动状态为 queued/running/cancel_requested。

线程关联从 mail_links 和 References/In-Reply-To 派生，不仅凭相同主题。semantic_key 只用于候选去重；已应用事件键使用来源邮件规范标识、事件事实摘要及目标投递组合，检测到摘要冲突时进入复核。不同邮件重复通知先比对当前业务值，无变化则不产生可确认操作，不粗暴合并所有相似主题。

body_text 清理不删除消息行；证据片段单独保留在事件与审计。列表查询不返回正文、before/after 快照或全部事件，避免大响应。

### 19.1 迁移与回退

1. 打开旧库，读取 user_version；未知更高版本继续拒绝启动，禁止降级写库。
2. 迁移前通过 SQLite 一致性备份机制生成完整数据库副本并验证可打开，不能在 WAL 活跃时只复制主文件。具体 Node 24.14 可用备份接口在实现前核验；备份失败则不迁移。
3. 备份成功后在一个事务内建表、建索引、设置 user_version=2；失败回滚，保持旧库可用。
4. 迁移不得改动现有 applications 文档或 revision；原有业务数据升级逻辑单独保留并回归。
5. 增加对完整迁移备份的说明；不把 .sqlite 副本放入现有 JSON 恢复接口列表。
6. 退回旧程序前停止服务并恢复完整旧库副本，新版本产生的数据不会自动降级合并；文档明确该后果。

## 20. 状态机与版本规则

### 20.1 任务

queued → running → succeeded / partial / failed；queued 可直接 cancelled；running → cancel_requested → cancelled。进程重启将未终结任务标记 interrupted，用户重试创建新任务并引用原任务结果，不悄悄启动模型调用。

partial 表示至少一项成功且有失败或因限额未完成的项；全部失败为 failed；未开始的剩余项不能计入成功。连接失败不能转为 succeeded。

取消是停止后续步骤：每次读取/模型调用前后检查信号；取消后的迟到结果不继续生成新建议。已提交事务保留，前端展示已完成部分。task_items 让重试只处理未完成项。

### 20.2 建议

| 当前状态 | 事件 | 新状态 |
| --- | --- | --- |
| needs_input | 用户补目标/必要字段并通过校验 | pending，生成首个预览 |
| pending | 用户修改且重新预览 | pending，version 增加，旧预览失效 |
| pending | 用户确认且所有检查通过 | applied |
| needs_input / pending | 用户忽略 | ignored |
| needs_input / pending | 目标删除、恢复备份、通知明确被替代 | stale，记录原因 |
| pending | revision 不符 | stale；生成新预览后才可回 pending |
| ignored / stale | 用户显式重新打开 | needs_input 或 pending，重新校验和预览 |
| applied | 再次确认相同预览 | 保持 applied，返回原审计结果 |

applied 不重新打开。若要修正，创建新的纠正建议或手动编辑；不得改写已应用审计。建议没有有效操作或演算后没有差异时显示“无变化”，不允许为了记录历史而确认空操作。

首次 preview 请求可按 eventIds 创建建议，此后必须传 proposalId + expectedVersion。多页面编辑版本不符返回 409，不自动合并。

## 21. 事件、操作包与预览的数据契约

模型输出示例（事实层，不包含可执行任意补丁）：

```json
{
  "schemaVersion": 1,
  "events": [{
    "type": "interview_invitation",
    "company": "示例公司",
    "role": "Java 后端",
    "applicationNo": null,
    "stage": "二面",
    "schedule": {"date": "2026-09-28", "time": "14:00", "timezone": "Asia/Shanghai", "kind": "start"},
    "location": null,
    "meetingUrl": null,
    "evidence": [{"field": "stage", "quote": "邀请您参加二面"}],
    "uncertainties": []
  }]
}
```

示例只说明形状，生产结果中每个关键非空字段都要有证据或显式标记用户补充/推断，不因缺少 evidence 自动通过。验证器限制每封最多 10 个事件、证据最多 20 项、字段长度、合法日期时间与链接协议。null 表示未知，不表示清空现有数据。

服务端操作包只允许已有节点的 node 操作，data 白名单为 status/date/time/location/meetingUrl/notes/completedDate。结构调整、新建投递、删除投递、接受 Offer 不在首版模型操作范围；确有需要走现有手工界面。兼容旧 deadline 字段的转换由服务端适配器完成，不暴露给模型随意修改。

notes 默认追加带来源的短摘要，保留原备注；用户在预览明确选择替换时才覆盖。任何字段清空用显式 clearFields 表达，再转换为领域模型输入；模型的 null 不触发清空。

预览函数契约：

```text
buildPreview(record, validatedOperations, fixedTime)
  -> { afterRecord, businessDiff, sideEffects }
```

依次调用 applyChange，用同一个 fixedTime 演算；businessDiff 排除 updated 和历史条目的执行时间，包含所有节点、日期、备注、Offer 决策等实际变化。前后业务对象规范化后计算 content_hash；客户端不参与计算可信操作。

确认时使用当前真实时间再次演算，比较忽略审计时间后的结果与已存预览。一致才提交，防止部署代码变化使旧预览应用出不同效果。不复用预览时间作为真实操作时间。

## 22. HTTP 接口契约

新接口沿用来源检查与 JSON 要求；Agent 小请求限制 256 KiB，不能直接沿用备份接口的 64 MB。列表默认 20 项、最大 100，使用稳定 cursor 分页。时间范围校验顺序和最大跨度（建议 366 天）；每次分析仍有独立数量上限。

| 方法与路径 | 请求关键字段 | 成功返回 |
| --- | --- | --- |
| GET /api/agent/status | 无 | configured、maskedAccount、mode、model、activeTaskId；不含密钥 |
| POST /api/agent/test-connection | target: mail/model | 202 + taskId；仅用户主动触发；模型探测说明可能有少量用量 |
| POST /api/agent/sync | requestId、since、until、analyze、limit | 202 + taskId；相同 requestId 返回已有任务 |
| POST /api/agent/tasks | requestId、instruction、范围约束 | 202 + taskId |
| GET /api/agent/tasks/:id | 无 | state、progress、counts、safeErrors、resultIds、version |
| POST /api/agent/tasks/:id/cancel | expectedVersion | 200 + task；已结束则返回实际终态 |
| GET /api/agent/emails | cursor、limit、filter | 摘要列表、nextCursor |
| GET /api/agent/emails/:id | 无 | 纯文本正文、截断标记、附件名称、来源元数据 |
| GET /api/agent/proposals | state、cursor、limit | 摘要列表、nextCursor |
| GET /api/agent/proposals/:id | 无 | 完整建议、来源、当前预览、version |
| POST /api/agent/proposals/preview | eventIds、applicationId、operations；或 proposalId、expectedVersion | 200 + proposalId、previewId、version、baseRevision、diff |
| POST /api/agent/proposals/:id/confirm | previewId、expectedVersion | 200 + applied、replayed、auditId、record、resultRevision |
| POST /api/agent/proposals/:id/ignore | expectedVersion | 200 + state、version |
| POST /api/agent/proposals/:id/reopen | expectedVersion | 200 + 重新校验后的建议；可能 needs_input |
| POST /api/agent/drafts | requestId、messageId、instruction | 202 + taskId；阶段 D |
```

该表细化并替代第 11 节中 preview 路径的草案，采用统一 /proposals/preview 创建或更新预览。requestId 在持久化 task input 外另建 UNIQUE 请求键列；同键不同规范化请求内容返回 409 REQUEST_KEY_REUSED，不能复用执行不同任务。

错误兼容现有 error 文本，新增稳定 code 和 retryable：

```json
{"error":"投递已发生变化，请重新检查预览","code":"PREVIEW_STALE","retryable":false}
```

状态码：400 输入错误；403 来源非法；404 对象不存在；409 PREVIEW_STALE / PROPOSAL_VERSION_CONFLICT / ALREADY_APPLIED_DIFFERENT_PREVIEW / SYNC_ACTIVE；413 请求过大；422 无法形成合法业务建议；503 未配置或暂不可用。异步任务失败记录在任务结果中，轮询接口本身仍正常返回 200。

确认重复响应中的 record 和 resultRevision 是首次应用的快照，不一定是当前最新状态；前端随后 GET /api/state 刷新，不用旧快照覆盖用户后续修改。

## 23. 确认算法与现有 Store 的改造边界

```text
BEGIN IMMEDIATE
  读取 proposal 和 audit
  若已应用：
    相同 previewId -> 返回首次结果（不检查旧 revision，不再次写库）
    不同 previewId -> 409
  检查 state、expectedVersion、previewId、applicationId
  检查 preview.baseRevision == Store.revision()
  读取最新 application
  用真实执行时间重新演算，检查业务结果等于预览
  检查各事件尚未在目标投递应用
  一次性保存 application 与 source-aware history
  插入 audit 和 applied_events
  更新 proposal.state/version，生成新 revision
COMMIT
```

版本或事件检查失败时 rollback。发生网络断开不推断保存失败：前端查询建议状态，或用相同 previewId 重试。若前次确已提交，将返回原成功结果。

Store.transaction 当前固定更新 revision，不能直接拿来存所有 Agent 元数据。开发时拆出同步事务基础方法，业务事务在其上检查/更新 revision；Agent 元数据事务不动 revision。confirm 不能在现有 Store.change 外包另一层事务，应提取其“事务内读取、演算、保存”逻辑复用。

source-aware history 保持现有 type 和 text 兼容，附加可选 source 摘要（邮件本地 ID、主题摘要、建议 ID）。检查 validateApplication 与备份往返是否保留这些字段；必要时修改显式验证，不依赖未定义字段恰好被透传。完整证据留在 agent_audit，旧备份兼容性测试必须通过。

恢复 JSON 与删除投递在原有事务中同时使相关未应用建议失效；来源审计快照保留。恢复使全部预览失效，不把 audit 关联设为 ON DELETE CASCADE 导致审计丢失。

## 24. 外部适配器与资源限制

### 24.1 MailAdapter

内部接口：testConnection(signal)、scan(range,cursor,signal)、readMessage(identity,signal)。返回结构化数据与安全错误类别，不返回原始认证异常。

读取邮件先获取结构与大小，再按正文部分读取；首版不为正文抽取下载所有附件。正文解码后建议最大 64 KiB、模型输入每封最多 12,000 字符，超限标记截断并进入需检查状态；不能仅把 UI 截断当作模型仍看到了完整正文。

扫描批次按 UID 数值升序，邮件或明确的不可解析占位状态持久化后才推进游标。网络失败的 UID 不跳过，重试从最后可靠位置继续；长期不可解析项保存明确错误，可手动重试。日期补扫使用独立 scan_state，不能倒退增量高水位或跳过范围外新邮件。UID 集中不连续属于正常现象。

模型的 get_email 只能访问任务允许的本地 messageId，不接受任意邮箱路径或 IMAP 命令。测试使用 fake adapter，不在测试进程中加载真实凭据。

### 24.2 DeepSeekAdapter

接口 complete({messages,tools,signal}) 返回标准化 assistant 内容、toolCalls 与 usage。保留官方协议要求的消息字段，由适配器处理，领域服务不依赖厂商响应结构。

每次模型请求建议 60 秒超时，限流/暂时性网络或 5xx 最多重试 2 次，退避 1 秒、3 秒并尊重有界 Retry-After；所有重试计入任务次数和总时限。认证、余额、参数错误不盲目重试。失败调用也可能计费，任务页不保证重试免费。

模型输出截断或工具参数无效不能部分执行；返回工具校验错误给模型或结束该项。未知工具拒绝，调用数量和任务作用域在分发器强制校验。模型没有 confirm 工具，不能通过换名或构造嵌套参数触发业务写入。

固定同步流程先确定候选邮件，再逐封抽取，候选投递摘要按需查询，最多 10 条；查询仍有歧义时让用户选择，不把全部历史塞入模型。多轮对话仅保存当前任务必要上下文，模型任务日志不记录完整私密请求。

## 25. 前端状态、失败恢复与可访问性

邮件模块独立管理任务与建议，不复用现有页面的 busy 阻塞整个工作台。任务运行期间仍可查看和手工编辑投递；这会使旧预览失效，是预期行为。

打开任务页时建议每 2 秒轮询，隐藏页面时降至 10 秒或暂停；返回页面立即刷新。HTTP 请求本身仍使用短超时；任务取消通过服务端接口，不等同于取消一次轮询请求。

确认按钮在请求中禁用。超时后显示“正在核实保存结果”，查询建议状态，不立刻再次提交不同预览。成功后刷新 /api/state 与待确认数量；失败保留用户编辑内容。

建议编辑和原文查看用明确标题、字段标签、键盘可达按钮。原文与模型文字统一转义，不直接插入 HTML。加载和任务结果使用适度 aria-live 提示，轮询不反复抢焦点。窄屏按“目标 → 差异 → 原文”排列，长文本可展开。

## 26. 可直接领取的开发任务

以下为开发前任务拆分，实际进度见第 28 节。T00—T04 构成无需 token 的首个可演示闭环；之后才接真实外部服务。每个任务完成后只推进到已通过验收的下一步。

| ID | 依赖 | 代码范围与交付 | 完成标准 |
| --- | --- | --- | --- |
| T00 | 无 | test/fixtures/agent：人工构造邀请、改期、拒信、多岗位、HTML、缺失年份案例；fake mail/model adapters | 所有样例明确标演示，不含真实个人邮件；新测试不读 data/ 或真实环境凭据 |
| T01 | T00 | store migration、Agent repository、共享事务基础设施 | v1→v2 安全迁移；备份失败不迁移；元数据不改变业务 revision；未知更高版本拒绝 |
| T02 | T01 | 事件/操作验证、预览演算、差异、建议持久化 | 模拟邮件可生成完整预览；无确认投递不变；连带变化与 applyChange 一致 |
| T03 | T02 | confirm/ignore/reopen API、幂等、审计、恢复/删除协同 | 多操作原子保存；故障注入全回滚；重复确认一次历史；旧预览冲突；来源备份往返兼容 |
| T04 | T03 | 邮件助手入口、模拟建议列表、详情、修改、确认、来源历史 | 用演示邮件从列表到原进度线完整操作；刷新/重启保留建议；键盘与小屏可用 |
| T05 | T04 | QQ 配置、ImapFlow/mailparser、连接检查、同步任务与游标 | adapter 契约测试覆盖 UID 重置、重复、超限、解析失败；真实验证另记，没凭据不能标真实通过 |
| T06 | T04 | DeepSeek 官方接口核验、模型配置、适配器、抽取与匹配 | fixture 响应可校验；错误脱敏；日期不猜；唯一和多候选分别处理；无 token 时用契约测试 |
| T07 | T05,T06 | 同步→分析→建议整合，任务进度、取消和恢复 | 部分失败可单项重试；游标不漏信；已确认事件不重放；各资源限额生效 |
| T08 | T07 | 设置说明、真实邮件小范围联调、回归与发布文档 | 用户本地配置后只读联调；手动确认一条更新；新旧功能回归；实际未验证项明确列出 |
| T09 | T08 | 自然语言任务工具循环、汇总、本地回复草稿 | 多轮执行可用；未知工具和绕过确认失败；生成/应用/发送状态不混淆 |
| T10 | T09，另行明确范围 | QQ 草稿箱与用户确认发送 | 服务端绑定预览内容；结果不明不重发；独立审计；真实发信需明确触发 |

T08 为核心邮件更新版本的发布门槛，T09 完成自然语言 Agent 体验；不把仅有固定抽取流程的 T08 宣称为完整对话 Agent。T10 为可选扩展。

### 26.1 测试与执行命令

沿用 npm test 和 npm run check，并把新增 JS 文件纳入语法检查。新增测试分为 agent-store、agent-proposals、agent-http、mail-adapter、deepseek-adapter、agent-runner；沿用现有隔离临时目录约束。

关键自动化：migration 故障、事务故障、跨站拒绝、未知工具、参数越权、revision 冲突、重复确认、恢复后失效、迟到模型响应、同步分页中断、UIDVALIDITY 变化、缓存清理后证据仍可查。

浏览器检查记录具体操作与实际结果，不以 HTML 字符串断言替代交互检查。安装依赖后执行 npm ci；真实邮箱和模型验证不放进普通 npm test，避免测试意外访问个人邮箱或产生费用。

### 26.2 实施完成的证据

每项任务更新本节状态，记录修改文件、测试结果和剩余限制。发布说明区分模拟验证、真实只读联调、真实节点确认三类证据；未实际验证不得写“已支持且验证通过”。

## 27. 开发前的剩余核验清单

不再有阻塞模拟闭环开发的产品问题。剩余核验分配到具体任务：T01 确认当前 Node 版本一致性备份 API；T05 锁定依赖和 QQ 真实协议兼容；T06 核验 DeepSeek 模型与协议；T08 才需要本地真实凭据。

当前批准范围是补齐开发设计和任务清单。本轮未安装依赖、未创建表、未改变应用行为；代码实现尚未开始。

## 28. 首版实施记录（2026-09-25）

当前代码已实现：T00—T04 模拟邮件的完整预览确认流程；T05 QQ 只读正文同步；T06 DeepSeek 结构化抽取与候选匹配；T07 异步任务、取消、错误和重试；T09 多轮工具对话与本地草稿。T08 的自动化/本地浏览器部分已完成，真实 QQ 和 DeepSeek 联调尚待本地配置凭据。T10 为可选扩展，未实现发信或保存至 QQ 草稿箱。

### 实际工程选择与设计稿差异

- 为沿用现有 JSON 文档存储风格，首版采用 agent_messages、agent_proposals、agent_audit、agent_tasks、agent_state、agent_drafts 六张表；事件、预览与任务进度嵌入文档，并有独立 SQL 状态列和唯一键。没有机械创建设计稿所有规范化表。业务写入与确认审计仍保持同事务。
- 增量读取在用户选定日期范围内查询 UID，并跳过已持久化的稳定标识；没有单独的高水位游标。重扫 UIDVALIDITY 变化后的新命名空间，个人邮箱首版以简单、可复查为优先。不同命名空间的相同邮件可能再次出现，需要核对预览，不声称跨命名空间已完全去重。
- 支持同一邮件多个节点操作，但一个邮件只保留一个建议包；已生成建议可手动修正，未实现多版本模型重新分析和自动取代旧改期建议。
- 预览只允许已有节点字段；未知轮次、缺失正文或冲突留给用户选择。没有自动创建投递、自动增删流程、自动接受 Offer。
- 邮件正文按 MIME 部分抓取，最多 64 KiB；不下载附件。模型正文最多 12,000 字符，截断后转人工处理。
- 来源摘要写入原有 history.text，备份兼容；历史提供邮件助手跳转链接。完整证据与确认差异独立保存在审计表，正文清理后仍可核对事件证据。
- 新接口仍使用既有 error 文本和 HTTP 状态码，尚未为全部错误细分稳定 code；当前前端不依赖错误文字判断是否已保存，而是再次查询服务端建议状态。
- 列表使用有界 limit/offset 分页，刷新后重新读取；没有实现无限规模游标查询。首版每次加载 20 项。

### 验证证据

- npm ci：锁文件安装成功，依赖审计 0 个已知漏洞（本次安装结果）。
- npm run check：新增模块及原模块语法检查通过。
- npm test：78 项通过，其中 15 项新增 Agent 测试，覆盖事务故障回滚、幂等、过期预览、恢复/删除失效、迁移备份、原文校验、模型错误脱敏、工具权限、任务取消、只读 UID 与附件隔离、多操作原子性和缓存清理。
- Chrome headless 在隔离数据库中完成：加载演示邮件 → 关联投递 → 核对 → 生成完整预览 → 检查投递仍未变 → 确认 → 检查节点已保存。1440px 桌面与 390px 手机宽度无脚本错误、无横向溢出。
- 浏览器截图与检查脚本位于 .preview/agent-browser/ 与 .preview/agent-browser-check.mjs，不属于发布依赖。
- 未读取真实 data/ 中的投递，未连接个人邮箱，未使用真实模型凭据；真实成功率与 QQ 服务器兼容性不以模拟测试替代。

本地配置与限制见 [邮件助手使用说明](email-agent-usage.md)。根目录 .env.local 如原先不存在，已从空白模板创建；未覆盖已有配置。填写凭据后重启，使用页面连接检查与小范围同步完成真实联调。
