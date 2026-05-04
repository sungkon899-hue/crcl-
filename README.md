# CRCL DCA · Circle 智能定投评分系统

5维度评分 → 0-100综合分 → 0.1x-3.0x定投倍数

## 数据源

| 数据 | 来源 | 方式 |
|------|------|------|
| CRCL股价、RSI、MACD、布林带、200MA | Yahoo Finance Chart API | 自动 |
| VIX 恐慌指数 | Yahoo Finance | 自动 |
| USDC 流通量 | DefiLlama Stablecoins API | 自动 |
| 加密恐惧贪婪指数 | Alternative.me | 自动 |
| 联邦基金利率 | FRED（需API Key）| 可选自动 |
| PS比率、PS百分位 | Yahoo Finance quoteSummary | 自动（百分位需历史数据，暂手动） |

## 部署到 Vercel（推荐，最简单）

### 1. 准备

```bash
# 克隆或下载项目文件到本地
cd crcl-dca-site

# 安装依赖
npm install
```

### 2. 本地测试

```bash
# 启动开发服务器
npm run dev
```

注意：本地开发时 `/api/data` 需要 Vercel CLI 来运行 serverless function：

```bash
# 安装 Vercel CLI
npm i -g vercel

# 用 vercel dev 代替 npm run dev（同时启动前端和API）
vercel dev
```

### 3. 部署

```bash
# 一键部署到 Vercel
vercel deploy --prod
```

或者：
1. 把代码 push 到 GitHub
2. 在 [vercel.com](https://vercel.com) 导入 GitHub 仓库
3. 自动部署，获得 `xxx.vercel.app` 域名

### 4. 可选：启用 FRED 自动利率数据

1. 去 [FRED](https://fred.stlouisfed.org/docs/api/api_key.html) 免费申请 API Key
2. 在 Vercel 项目设置 → Environment Variables 添加：
   - `FRED_API_KEY` = 你的key
3. 重新部署

### 5. 绑定自定义域名

Vercel 控制台 → Settings → Domains → 添加你的域名

## 项目结构

```
crcl-dca-site/
├── package.json          # 依赖
├── vite.config.js        # Vite 配置
├── vercel.json           # Vercel 部署配置
├── index.html            # HTML 入口
├── api/
│   └── data.js           # Serverless API（聚合5个数据源）
├── src/
│   ├── main.jsx          # React 入口
│   ├── App.jsx           # 主组件（UI + API调用）
│   └── scoring.js        # 评分引擎（独立模块）
└── README.md
```

## 评分算法

```
Score = 估值(30%) + USDC(25%) + 利率(20%) + 技术(15%) + 情绪(10%)
Mult  = piecewise_linear(Score → [0.1x, 3.0x])
Final = Score + earningsPulse(±10)
if drawdown >= 30% || position >= 20%: HALT
```

## 风控规则

- 回撤 ≥ 30% → 熔断暂停
- 仓位 ≥ 20% → 停止加仓
- 单周限额 = 基础金额 × 3
- 财报后 ±10 分脉冲调整
- 连续5日85+分 → 降档至1.5x

## 后续迭代方向

- [ ] PS百分位历史数据自动计算
- [ ] 回测模块（CRCL上市以来）
- [ ] 公众号自动生成评分卡图片
- [ ] 历史评分趋势图
- [ ] Telegram/WeChat 推送通知
