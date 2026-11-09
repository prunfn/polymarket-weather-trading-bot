# Polymarket 天气交易机器人
<img width="680" height="355" alt="HGYvjq4a4AAiRJw" src="https://github.com/user-attachments/assets/b6829db7-0713-424a-b384-73602ae4e969" />

[English](README.md) · **简体中文** · [Русский](README.ru.md)

**Phase 1：仅支持只读研究和本地纸面模拟，无需钱包凭证。安全边界及后续要求见 [SECURITY.md](SECURITY.md)。**

一个用 TypeScript 编写的机器人，用于交易 Polymarket 上的**每日最高气温**市场
（例如「6 月 19 日首尔的最高气温会是 29°C 吗？」），它使用**概率预测**而非单点估计。

它做的正是高水平天气交易者手动在做的事：构建当天最高气温的*概率分布*，把它转换成
市场上每一个 °C 区间的概率，再与实时订单簿价格比较，**仅在模型与市场出现显著分歧时**
有选择地、按合理仓位下注。

```
集合预报 ──► °C 区间上的分布 ──► P(区间)
                                    │
实时订单簿 ──► 每个区间的市场价格 ───┤
                                    ▼
                       优势 = P(区间) − 价格
                       │  (按 最小优势 / 价格 / 流动性 过滤)
                       ▼
              分数凯利仓位 ──► 风险上限 ──► 下单
```

## 工作原理

| 阶段 | 模块 | 作用 |
|------|------|------|
| 发现 | [src/polymarket/gamma.ts](src/polymarket/gamma.ts) | 通过 Gamma 的 `public-search` API 查找活跃的「{城市} 最高气温」事件，并把每个 Yes/No 市场解析为温度**区间**（`≤24`、`=25`、…… `≥34`）。 |
| 预报 | [src/weather/forecast.ts](src/weather/forecast.ts) | 拉取 **Open-Meteo 集合预报**（4 个模型约 140 个成员），取每个成员的当日最高值，构建高斯核密度分布。对美国城市，会以 **NWS** 确定性最高值重新对中。 |
| 区间计算 | [src/strategy/buckets.ts](src/strategy/buckets.ts) | 按每个城市的取整规则，把每个区间映射到能令其成立的真实温度区间 `[lo, hi)`。 |
| 优势 | [src/strategy/edge.ts](src/strategy/edge.ts) | 把模型 P(区间) 与实时卖价比较（Yes 和 No 两侧都看），保留通过 优势/价格/流动性 门槛的候选。 |
| 仓位 | [src/strategy/sizing.ts](src/strategy/sizing.ts) | 分数凯利仓位：`f* = (q − p)/(1 − p)`，再乘以 `KELLY_FRACTION`。 |
| 风险 | [src/risk/guards.ts](src/risk/guards.ts) | 单市场、单事件、总敞口与单日亏损上限。 |
| 执行 | [src/trading/executor.ts](src/trading/executor.ts) | 仅模拟成交；实盘执行被禁用。 |
| 跟踪 | [src/trading/portfolio.ts](src/trading/portfolio.ts) + [src/store/db.ts](src/store/db.ts) | 持仓、敞口与已实现盈亏，持久化到 `data/state.json`。 |

## 安装

```bash
nvm use
npm ci --ignore-scripts
cp .env.example .env        # 然后编辑 .env
```

编辑 `.env`。所有项都有安全默认值，且 `TRADING_MODE=paper`，因此你完全不需要钱包
即可运行只读命令。

## 命令

```bash
npm run forecast -- hong_kong          # 打印温度分布
npm run forecast -- nyc 2026-06-20     # 指定日期

npm run scan                           # 分析所有市场，显示优势 + 拟下单
                                       # —— 绝不真正下单

npm run run-once                       # 执行一轮（仅纸面模拟）
npm run watch -- 10                    # 每 10 分钟重复执行一次

npm run auth                           # 已禁用，不派生或打印凭证
npm run portfolio                      # 持仓、敞口、已实现盈亏
```

`scan` 始终是只读的，无需任何凭证 —— 从它开始。

## 开启实盘

本阶段禁用身份验证与所有实盘下单。不要配置私钥、API secret 或 passphrase。`TRADING_MODE=live` 无法开启交易；后续要求见 [SECURITY.md](SECURITY.md)。

## ⚠️ 信任它之前先做校准

预报质量的上限取决于它与**官方裁定气象站**的吻合程度。
[src/weather/cities.ts](src/weather/cities.ts) 中有两个最关键的旋钮：

- **`rounding`** —— 气象站报告的是*四舍五入*（`26` = 25.5–26.5）还是*向下取整*的
  整数？选错会让每一个概率都发生偏移。
- **`biasC`** —— 当模型的 2 米气温相对气象站微气候系统性偏高/偏低时，做一个小的
  加性修正。

运行 `scan` 时，你有时会看到**非常大**的模型与市场之间的优势。把它们当作*验证你
校准的提示*，而不是免费的钱 —— 市场往往比未校准的模型更了解气象站的脾性。
使用 [src/weather/openmeteo.ts](src/weather/openmeteo.ts) 中的 `archiveDailyHighs()`，
用历史官方最高气温回测模型输出，并在投入资金前调好 `biasC`。

## 内置安全防护

以下功能默认开启，可在 `.env` 中调整：

- **优势合理性上限**（`EDGE_SANITY_CAP`，默认 0.35）—— 超过此值的优势被视为*模型
  错误*并跳过，因此机器人绝不会在最被错误定价的信号上下最重的注。
- **离散度放大**（`SPREAD_INFLATION`，默认 1.4）—— 当日最高气温的集合预报通常离散度
  不足；这会拓宽预测分布，让模型不再制造虚假的确定性。
- **日内下限** —— 对当日市场，分布会被钳制在今天已观测到的最高气温之上（最高值不
  可能低于它）。
- **临结算防护**（`MIN_MINUTES_TO_RESOLVE`，默认 60）—— 绝不交易即将结算的事件。
- **不漏底的上限** —— 单市场、单事件与总敞口上限会同时计入已记账的持仓*以及*本轮
  中更早已承诺的下注额，因此重复的 `watch` 轮次无法累积超过上限。

本软件仅供研究/教育用途。交易涉及真实的财务风险；你需为自己的资金与决策负责。

## 说明

- 订单簿读取已迁移到官方 `@polymarket/client`。原有策略与天气预报计算保持不变。
  SDK 兼容性及剩余风险见 [SECURITY.md](SECURITY.md)。
- 无需任何付费服务：Open-Meteo 与 NWS 均免费且无需密钥。

[参考来源](https://x.com/polysuccubus/status/2046644181347491847)
