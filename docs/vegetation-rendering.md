# 草撮密度与调试层

## 当前草贴图：直接加载四张原始 PNG

- 正式纹理：`public/assets/vegetation/grass_0.png`、`grass_1.png`、`grass_2.png`、`grass_3.png`。每款草撮直接使用自己的 PNG，不再运行图集处理脚本、不再加载旧 `grass-tufts-cc0.png`。
- 文件中的草叶主要集中在图像下半部（根部在底边），`src/grass-blade.ts` 仅通过 UV 限定有效 Alpha 区域以消除多余透明空间；**不裁切、重绘或重新压缩源图片**。其中 `grass_2.png` 是 559×512，其他是 512×512。
- 几何：每撮草一张面，沿高度分成上下两个连续倾斜四边形；不用旧 Grass Medium 草模型。
- 颜色：这四张源图作为**暗色明度贴图**。`src/vegetation-palette.ts` 的 `grassTextureAlbedo()` 读取原图每个像素的线性亮度，以灰橄榄绿色重新着色，但保留暗亮层次，而不是用纯色抹平叶片。Alpha 裁切、PBR 受光和 Debug 随机染色功能继续生效。
- 独立随机浮动：`src/meadow.ts` 中宽度 `0.9–1.1` 倍、高度 `0.9–1.1` 倍、明暗 `0.9–1.1` 倍；三项分别取随机值，不再复合多项旧缩放造成超范围波动。

## 基础草密度加倍

`src/vegetation-distribution.ts` 的 `grassTuftSeeds()` 抖动网格从 **0.25m** 变为 **0.25/sqrt(2) ≈ 0.1768m**。因此同面积上最大候选数从 **16/m²** 翻到 **32/m²**；`src/meadow.ts` 原有的连续低中高频噪声过滤、近路路肩/缓冲区排除、坡地/水面等限制均保持不变。

注意“基础密度翻倍”指独立候选草撮数量提升两倍；实际留存数量由同一噪声场和遮挡排除决定。由于草撮形状没有变化，尽量用更多小草撮填补稀疏间隙，而不是堆高旧草团模型。需要实际画面与帧率验收。

## Debug：草撮随机染色

Sidebar「Debug 显示层」新增「草撮随机染色」。`src/grass.ts` 的草材质加入 `plantGrassDebug` uniform：开启时按每个草撮**根部世界坐标**生成稳定高对比的随机 RGB。一个草撮里的两段网格使用完全相同的调试颜色，能分辨覆盖、重叠、LOD、贴地问题。

关闭时材质恢复依照图片亮度重新染绿的 `grassTextureAlbedo` 灰橄榄色。切换只改变已有材质 uniform，不重新散布、不重新生成贴图。开关状态保存在 `GameScene` 并在重建 `GrassField` 时重新设置。

## Debug：缓冲区 Score 计算路径，而不是生成面或轮廓

**真实计算来源**为 `src/runoff-profile.ts`：

1. `approachSpeeds()` 沿赛道采样点传播 `score = v²`。匀速路段按加速度累加 `2*a*distance`，入弯消耗 `2*braking*distance`；闭合赛道在记录前用二分法求周期解。
2. `applyRunoffProfile()` 用曲率计算弯道速度平方上限 `cornerLimits`，采样弯道累计转角、超额横向需求与 severity，再从这个 score 推导 `reserve` 和恢复宽度 `peakWidth`。
3. `runoffBoundary()` 随后根据计算出的预留宽度创建光顺的路肩/缓冲区轮廓和面。**Debug 不显示这一步的 Mesh 或几何边界**。

新增 `runoffScoreTrace(track)`：在第 2 步保留的采样点直接缓存真实 score、弯道限速、severity 和恢复偏移；读取时不重新实现或猜测 score 算法。

`src/debug-layers.ts` 改为绘制：
- **青 → 红的 Score Path**：按采样顺序沿算法真实赛道积分路径连接，较高弯道风险趋向红色，低风险为青色
- **黄色短线**：从存在显著恢复需求的弯道采样点向弯外画出由 score 算法算出的 `recoveryOffset`，用于可视化缓冲方向。这是**风险/恢复诊断线，不是真正模拟汽车飞出后的运动轨迹**
- 侧栏显示 Score 线段数、高风险段数和向外诊断线条数
- 仍于 HDR/TAA 后处理完成之后独立绘制，保证开启时线条可见；不改变车辆碰撞或正式缓冲区生成

重要说明：目前并没有车辆失控状态的逐时间积分模拟，只有`v²`沿赛道传播 + 弯道风险与缓冲距离评估。若未来需要实际车辆冲出去的曲线，应单独增加车辆物理速度、航向和轮胎抓地动态的模拟，而不是假称现在的 `score` 就是失控行车轨迹。

## 验收

已执行一次 `pnpm exec tsc --noEmit` 并通过。按 `AGENTS.md`，未运行浏览器验收、游戏截图、自动测试或帧率基准；画面和性能由实际游玩反馈。
