# 晴天光照与树冠渲染

真实赛道与手绘赛道共用这一套渲染逻辑。改动集中在光照、共享材质和离线树木素材，没有调整赛道数据、碰撞、植被数量或 LOD 距离。

## 太阳与天空

`src/daylight.ts` 从固定晴天 HDR 的上半球查找太阳，按 Three.js 的等距柱状采样方向对齐方向光。天空背景保留原始 HDR；另复制一份供 PMREM 使用，只把太阳周围半径 0.75° 内的亮盘压至邻近天空色，至 1.5° 平滑过渡。邻近天空色来自 1.5–4° 的环带，并按立体角加权。

这样可减少太阳亮盘作为无阴影环境光重复进入场景的问题。方向光继续提供太阳直射及阴影，HDR 保留天空和地面反射。环境强度 0.58、半球光 0.65、中性环境光 0.085、太阳强度 3.4、曝光 0.92 均保持原设置。这是沿用项目相对强度的光照分工，没有实现 BeamNG 的 lux / EV100 标定。

太阳阴影使用 Three.js CSM：三段 2048² PCF 阴影图、practical 分割、级联渐变，覆盖相机前方 420 米。各段在日光坐标系内按像素对齐，避免世界 XYZ 对齐后斜向日光仍滑动。太阳能量仍是 3.4，级联按深度选择和混合，不把三盏级联光相加。树叶和草的透光接在每个光源的受阴影照明函数中，与级联选择一起生效。

## 完整驾驶渲染流程

`src/daylight-pipeline.ts` 将所有赛道统一接入：线性 HDR 场景与运动信息 → GTAO 与丁达尔体积光 → 运动重投影 TAA → ACES 与 sRGB 输出。没有额外暗角，HDR 天光、半球补光和中性环境补光保持原设置。

- **级联阴影**：`src/cascade-sun.ts` 使用项目现有 Three.js r181 官方 CSM 插件，并串接原有材质编译回调，保留路面、树冠、草和水面的自定义着色。新建草分块与车辆材质自动登记；材质释放时从级联登记表移除。实现接口参考 [Three.js CSM 文档](https://threejs.org/docs/pages/CSM.html)。
- **GTAO**：使用本地 r181 `GTAOPass`，半分辨率、8 样本及 Poisson 去噪，世界空间半径 0.65 米。输入来自正常场景实际渲染的深度，保留叶片透明裁切、草风动和道路深度优先级，没有用无透明裁切的 overrideMaterial 重绘植物。以 30% 强度混合，避免阴影再次压黑；按深度进行边缘保留上采样。
- **丁达尔体积光**：`src/daylight-post-shaders.ts` 在半分辨率沿视线积分 24 步、最长 280 米，使用随高度降低的空气密度、Beer–Lambert 透射衰减与 Henyey–Greenstein 前向散射。每一步根据视深选择太阳级联，读取真实阴影图；树木、桥梁和设施因此能遮住空气中的太阳散射。采样到可见表面即停止，不穿过实心物体。只叠加太阳单次散射，宽范围空气雾继续由原有距离雾承担，避免重复添加一层灰雾。空气基准高度来自地形，行驶时不会随车辆上下移动。
- **运动重投影 TAA**：`src/temporal-materials.ts` 在同一次场景绘制中，向第二个 HDR 附件写入运动、上一帧深度及覆盖率。静态环境使用上一帧相机矩阵；车辆、轮子、方向盘等刚性 Mesh 分别保存上一帧世界矩阵；草在同一个顶点着色器中计算前一帧风动位置。使用 8 相位 Halton 亚像素抖动、深度遮挡拒绝、3×3 邻域的 YCoCg 方差裁切和随运动速度变化的历史权重。MSAA 边缘在解析后按覆盖率还原运动值，避免把天空的零运动稀释进叶缘。
- **透明与反射**：水面、胎烟等没有可靠表面对应关系的内容写入响应标记，拒绝累积旧颜色，减少水纹、烟雾拖影。保留原来的透明排序、深度测试和水面反射捕获。时域累积在最后进行，颜色管理只在最终输出执行一次。
- **历史重置**：切换赛道、车辆、视角、调整窗口、重建素材、相机大幅跳转或近远裁切面变化时丢弃旧历史，防止上一场景残留。

半浮点渲染需要 `EXT_color_buffer_float`。缺少该能力时保留 CSM 和原有直接场景渲染，不绑定不完整的浮点帧缓冲；浮点目标不支持 MSAA 时使用普通 Alpha 裁切配合 TAA。全套流程增加了三张阴影图、HDR 运动缓冲、时域历史和半分辨率效果缓冲，实际 GPU 时间与显存占用没有做基准测试。

## 树冠与叶片

- 离线为每个叶片顶点计算连续椭球包络法线，用于树冠整体明暗；保留少量向外定向的原始法线细节。
- 用 `_LEAF_NORMAL` 单独保存原始叶片法线。运行时正确处理实例的旋转和非等比拉伸，用它确定叶片朝向、背光透射及前向散射。
- 薄叶散射接入 Three.js 的直接光照函数，读取已应用阴影的光源颜色，遮挡处不会凭空发光。
- 环境漫反射按正反方向 0.76 / 0.24 混合，移除统一的朝上天空亮度下限，以保留树冠方向性和体积层次。保留有下限的体积遮蔽近似；现有 `_CANOPY_OCCLUSION` 是几何位置估算，不是光线追踪烘焙 AO。
- 树木采用不透明队列、双面、深度测试与深度写入。在实际支持 MSAA 的上下文中启用 Alpha to Coverage，边缘平滑围绕 0.5 裁切阈值对称展开；不支持 MSAA 时使用普通裁切。阴影深度同样以 0.5 裁切。
- 树叶图集与地被共用颜色扩边、线性光预乘降采样和覆盖率修正的原始 RGBA mip 链，减轻叶缘黑边及远景覆盖流失。每个树种的三个 LOD 共用贴图，只处理一次。
- LOD 互补抖动在 Alpha 裁切之后执行，颜色与阴影深度都保留过渡；没有把 LOD 渐隐变成透明混合。

已重新生成橡树、梣树、松树的全部九个 GLB，三角形数量保持原样。单文件仍小于 1 MiB；新增原始叶片法线使总素材增加约 592 KiB。来源、许可和加工记录继续写入 `public/assets/vegetation/manifest.json`。使用 `node scripts/prepare-vegetation.mjs` 可从本地素材缓存重建。

## 技术参考与范围

- [EvoVision](https://xun.archi/ecovision)：参考树冠包络法线、保留原始叶片法线和低成本透光模型；本项目仍保留 Three.js PBR，没有照搬其 Half-Lambert / Blinn-Phong 材质。
- [NVIDIA GPU Gems 3：SpeedTree 渲染](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-4-next-generation-speedtree-rendering)：参考双面薄叶光照、MSAA / Alpha to Coverage，以及与 LOD 过渡的配合。
- [Three.js Material](https://threejs.org/docs/pages/Material.html)：核对 Alpha to Coverage 的 MSAA 前提，以及 Alpha Hash 的噪声特性；实际接入同时核对项目安装的 Three.js r181 着色器与阴影代码。
- [Hashed Alpha Testing](https://discourse.threejs.org/t/hashed-alpha-testing/86294)：作者说明其结果依赖良好 TAA。本项目已加入运动重投影 TAA，继续以覆盖率 mip 与 MSAA 处理叶片轮廓，没有默认切换为 Alpha Hash 噪声裁切。
- [BeamNG：Physically Based Lighting](https://documentation.beamng.com/modding/lighting/pbl/)：参考太阳、天空、环境照明与曝光各司其职的思路，不直接套用另一引擎的强度数值。

已加入 CSM、GTAO、运动重投影 TAA 和丁达尔体积光。当前树木仍使用现有叶片贴片资产，没有迁移为 AMD GPU Work Graphs 的真实叶片生成或 Nanite 引擎，也没有添加光线追踪与全场实时 GI。

已完成素材加工、TypeScript 无输出编译及 Vite 生产构建；没有运行测试、自动浏览器验收、截图回归或性能基准，也没有执行 GPU 着色器运行验收。实际明暗、光束、快速运动中的拖影和驾驶性能由游玩验收。

## 草与树叶白边修正

针对游玩截图中的浅色描边，统一调整 `src/foliage-cutout.ts`，草、灌木与树叶共享处理：

- 从可靠的不透明叶色出发扩展到整个透明背景，取代原先仅 8 像素的范围。实测原始橡树图集低 Alpha 区域平均 RGB 明显比不透明叶色更浅；过滤时必须处理这些颜色，不能只清除 Alpha 为零的像素。
- 原始 mip 链仅从未做覆盖率缩放的上一级生成，颜色按线性光和 Alpha 加权。覆盖率缩放只用于上传副本，避免低 Alpha 边缘逐级膨胀。缩放有上限，极小 mip 不强制至少保留一个不透明像素。
- 草和树叶共用对称、有上限的 MSAA 裁切带，并明确排除零 Alpha。此前树木的无上限导数带在斜视、小贴片时可能扩展到裁切阈值以下太远，给空白区域带来覆盖；草原先又使用了另一套偏移裁切，两者现已统一。
- 草沿用源材质记录的实际 MSAA 支持状态，不支持时回退普通裁切。保留深度写入、实例化、LOD 与原有光照。

本次参考 [threejs-nanites 的透明纹理处理说明](https://github.com/VictorZakharov/threejs-nanites/blob/main/AGENTS.md)：该项目同样记录了树叶 PNG 透明区白色 RGB 导致浅色 mip 光晕，以及覆盖率修正。其 [README](https://github.com/VictorZakharov/threejs-nanites/blob/main/README.md) 中的抖动叶缘依赖运动重投影 TAA，本项目使用现有 MSAA 轮廓加运动重投影 TAA。

[Codrops 草地文章](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/) 的实例化、分块、LOD 和按距离裁剪与现有结构一致，继续保留这些策略。[AMD GPU 树木论文](https://gpuopen.com/download/Real-Time_GPU_Tree_Generation.pdf) 提供程序化真实叶片几何和连续 LOD 的方向；该 28 MB PDF 未能全文抓取，本次只核对可检索的叶片几何 / LOD 段落及其 [作者代码仓库](https://github.com/Bloodwyn/gptree)，没有把 GPU Work Graphs 管线引入当前 WebGL 项目。

白边修正阶段进行了素材像素读取分析、代码复核与 TypeScript 无输出编译；完整渲染流程接入后另完成了 Vite 生产构建。没有运行测试或自动视觉验收，实际效果需游玩确认。
