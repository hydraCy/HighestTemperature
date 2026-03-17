# Polymarket Shanghai 平台产品规范（本地版真相源）

最后更新：2026-03-17  
适用范围：本地运行（`npm run dev`）的主链路

---

## 0. 运行模式（固定）

当前仅支持**本地运行模式**：
- 统一使用 `Next.js + Prisma + SQLite` 本地主链路
- 不维护 Cloudflare/Workers 分支口径
- 不维护分离式 Node 部署口径

页面刷新策略：
- 进入核心页面（`/`、`/three-pm`、`/market/[slug]`）即触发一次 `POST /api/refresh`
- 之后每 5 分钟自动刷新一次

---

## 1. 产品目标与边界

本系统是**单用户、只读、交易辅助**平台，不做自动下单。

核心目标：
- 在 Polymarket 上海“日最高温”市场上输出可执行建议：
  - `Decision`（BUY/WATCH/PASS）
  - `Recommended Bin + Side`
  - `Edge / TradeScore`
  - `Reason / RiskFlags`

明确边界：
- 不接私钥，不接钱包，不执行交易
- 辅助天气源不等于最终结算源
- 最终结算口径以 Polymarket 规则中指定的 Wunderground ZSPD 为准

---

## 2. 结算与日期口径（必须遵守）

### 2.1 结算时间定义

目标日 `D` 的结算窗口基准为：**上海时区次日 00:00**。  
即 `targetDayEndSettlementAt(D)`。

代码口径：
- `lib/utils/market-time.ts`
- 决策链路和切盘链路都必须使用该函数，不允许直接拿 `targetDate` 当结算时刻。

### 2.2 市场切换逻辑（今日/次日）

优先级：
1. 今日盘若仍 active 且未到结算窗口，优先使用今日盘
2. 今日盘关闭/不 active/进入结算窗口后，切到次日盘
3. 允许 `POLYMARKET_EVENT_SLUG` 手工覆盖，但仍受结算窗口保护

代码位置：
- `lib/services/polymarket.ts`

### 2.3 页面日期切换

页面支持 `d=YYYY-MM-DD` 目标日查询：
- `/ ?d=2026-03-18`
- `/three-pm?d=2026-03-19`

查询层按上海时区日范围过滤 market：
- `getDashboardData(targetDateKey?)` in `lib/services/query.ts`

---

## 3. 数据源架构与标签

## 3.1 sourceKind 分类（统一）

- `settlement`：Wunderground / Weather.com 类
- `observation`：AviationWeather/METAR/TAF 类
- `forecast`：Open-Meteo / WeatherAPI / met.no / qweather / nws_hourly
- `guidance`：wttr

代码位置：
- `src/lib/fusion-engine/sourcePolicy.ts`

### 3.2 权重基础项

基础权重：
- settlement = 1.4
- observation = 1.3
- forecast = 1.0
- guidance = 0.8

完整权重：
- `rawWeight = baseSourceWeight × matchScore × stationPenalty × accuracyScore × scenarioScore × regimeScore × freshnessScore × healthScore`

### 3.3 站点匹配原则

目标站点是 `ZSPD`。  
若来源不是精确站点，要按 stationType 降权：
- exact_station > city_level > region_grid > east_china_grid

---

## 4. 严格模式（Strict Gate）规范

### 4.1 默认规则（当前）

默认按 **sourceKind** 判定，不按单一源判死：
- 必需类别：`settlement + forecast + guidance`

解释：
- Open-Meteo 单点失败不应直接阻断
- 只要该类别仍有可用源，允许继续决策

### 4.2 手工强制规则（覆盖默认）

若设置 `WEATHER_STRICT_SOURCES`（逗号分隔），则进入“按具体源”严格模式。  
即：你指定了谁，谁缺失就阻断。

### 4.3 阻断行为

strict 未通过时：
- 强制 `decision = PASS`
- `tradeScore = 0`
- `positionSize = 0`
- 写入明确原因和缺失项

---

## 5. 天气数据与 freshness 规范

### 5.1 禁止假数据

- 源失败要显式标注 `status + reason`
- 不允许造假值“补齐”
- 缺失就缺失，由 strict gate 决定是否阻断

### 5.2 freshness 计算（当前）

freshness 不再允许固定写死（例如统一 1h）。  
必须根据源更新时间或最近有效时刻估算：
- `estimateSourceAgeHours(...)`
- `nearestRowAgeHours(...)`

位置：
- `lib/services/weather-assist.ts`

---

## 6. 模型与概率规范

### 6.1 目标

预测的是**结算 winning bin 概率分布**，不是普通天气展示。

### 6.2 全局联动约束（互斥市场）

在最终决策阶段执行：
- 仅目标温度所在 bin 可取 `YES`
- 其余 bin 统一按 `NO` 方向评估

避免出现多个 Yes 推荐。

### 6.3 不可能性约束

若观测/约束已排除某些区间，应把对应概率压到 0（下界/上界硬门槛）。

---

## 7. 决策与风控规范

### 7.1 评分

- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

### 7.2 决策阈值

- `tradableEV > 0.06 => BUY`
- `0.02 ~ 0.06 => WATCH`
- `< 0.02 => PASS`

### 7.3 风控触发

以下情况强制降级或阻断：
- 日期不一致（weather target 与 market target）
- freshness 过期
- strict gate 失败
- 市场不 active 或已过结算
- 近确定性价格过滤（避免 95%+ 无效赔率）

---

## 8. 页面显示口径规范

### 8.1 时间与日期标准（唯一）

不再支持 `tm` 参数，不再提供“上海/本地”显示切换。  
页面统一使用**上海口径 + 所选日期 `d=YYYY-MM-DD`**：

- 所有数据（盘口、天气、模型、决策）都必须与 `d` 对齐
- 结算时间显示固定为“所选日期的晚 12 点（24:00）”
- 若市场目标日与天气目标日不一致，必须阻断决策（强制 PASS）

### 8.2 面板一致性

有 `latestDecision` 时：
- 模型面板优先使用该次决策元数据
- 不允许和实时 fallback 混杂导致显示冲突

---

## 9. 刷新与任务

本地推荐链路：
1. `npm run job:once -- all`
2. `npm run dev`

验证链路：
- `npm run test`
- `npm run build`

---

## 10. 变更准则（强制）

任何涉及模型/数据/决策的改动，必须遵守：

1. **先改文档**（本文件 + 流程文件）
2. 再改代码
3. 跑本地验证（job/test/build）
4. 记录“改动前后行为差异”

禁止：
- 未更新文档就直接改核心逻辑
- 为了“看起来可运行”而加隐式 fallback 假值
- 修改结算口径但不统一全链路
