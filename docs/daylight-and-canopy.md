# 晴天光照与树冠渲染

## Far 交叉贴图树叶降饱和（2026-11-21）

Far 交叉面片使用离线已受光的高模烘焙图和 `MeshBasicMaterial`，因此无法像 Near/Mid PBR 树冠一样获得实时的定向受光层次，远处的浅黄绿叶片显得偏鲜。现在 `src/tree-billboard.ts` 在 `map_fragment` 之后，只对绿色占优的树叶像素（连续 `smoothstep` 权重）做调色：约 46% 的灰橄榄色明度混合，并将受影响像素的亮度乘约 0.84，保留树叶内部的阴影/纹理对比与 PNG Alpha，非绿色树干尽量不动；无需修改原始 PNG、重新烘焙、调 Near/Mid 或改变 LOD 距离。此步骤发生在 `treeLodFade` 的 Debug 红色覆盖之前，因此 Far Debug 开启时依然纯红。

## 树木 LOD Debug 覆盖染色（2026-11-21）

右侧「Debug 显示层」新增 **树木 LOD 染色** 开关：Near 高模亮绿、Mid（原 `*-far.glb`）亮黄、Far（两片交叉贴图）亮红。`src/tree-lod.ts` 的 `treeLodFade()` 在**彩色材质**的 `<color_fragment>` 之后，用可随时切换的 shared uniform 替换 RGB，不影响贴图 Alpha、树冠边缘透明裁切、LOD dither 和阴影深度通道。彩色覆盖会沿用实际物理材质的光照（Far 的烘焙贴图为 MeshBasic），但高模和中模的原色不会透出来。每棵树基于实例根部的世界 XZ 坐标产生固定随机亮度 `0.65–1.0`，同棵树的树干、树叶、LOD 切换前后的亮度保持一致。切换不重新分布植被、不重新构建实例，也无需重新编译 Shader，关闭后恢复原始材质颜色。开关随 `syncDebugLayers()` 在切换赛道和重新创建 `GameScene` 时同步。

## 树木 LOD：高模、原 far 中模、双面板 far（2026-11-21）

已通过 Beacon 在 `X:\\apex-kart` 执行离线烘焙，三个树种 `oak`、`ash`、`pine` 每种生成正视图和侧视图各 1 张 **1024×1024 透明 PNG**，共 6 张，位于 `public/assets/vegetation/tree-billboards/`。来源分别是最高精度 `oak.glb`、`ash.glb`、`pine.glb`，并非旧 mid/far 模型。`scripts/bake-tree-billboards.mjs` 启动本地临时 HTTP 服务和独立无头 Chrome WebGL；`scripts/tree-billboard-bake.html` 通过 `GLTFLoader` 加载高模，以从 +Z、+X 朝向树木的正交相机生成真实 PNG 和包围盒元数据。使用 `pnpm assets:tree-billboards` 可重新烘焙，要求本机安装 Chrome。它属于用户明确要求的离线**素材烘焙**，不是浏览器验收或自动截图测试。

运行时 `SceneAssets` 只加载近景高模和原 `*-far.glb`（现在作为 **Mid**），不再加载原 `*-mid.glb`；旧 `*-mid.glb` 文件暂时保留，未删除。`src/tree-billboard.ts` 用高模包围盒自动对齐树根和尺寸，创建一个合并几何体中的 **2 张互相垂直的矩形面，共 4 个三角形**：正面绑定 front，侧面绑定 side，两张贴图使用不同材质组。`src/scene.ts` 为树种按地块实例化 Near（高模）/Mid（旧 Far GLB）/Far（交叉面片），保留随机旋转、伸缩、颜色和按实例 LOD 过渡；远景贴图通过 `foliageCutoutTexture` 生成保留 Alpha 覆盖率的 mipmap，减少远处树冠变稀和黑边。烘焙图包含离线光照，远景采用 MeshBasicMaterial 避免再次给图像整体加光，且不投动态树影。

距离没有更改：Near 在 42–72m 逐步淡出，Mid 在 42–72m 渐入并在 145–210m 渐出，Far 在 145–210m 渐入。以上只作编译验证，未运行游戏画面测试或性能基准。

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
- 中、远景叶簇按空间邻近关系分组，每组保留一对原始交叉叶片，远景锚点也是中景和近景的子集。中景维持原来的两簇合一；远景在原来四簇合一的基础上，再将四个邻近组收为一对十字叶片，每对最多代表 16 个原始叶簇。只简化远景树叶，树干、枝条以及近中景模型保留原样。
- 三种树的远景交叉叶簇从 312 / 364 / 224 组降为 78 / 91 / 56 组，树叶三角形减少 75%。合并时累计原始贴片面积，再按面积比例的平方根补偿尺寸，各级 LOD 保留相同的叶片贴片总面积，继续共享图集和切换距离。面积补偿与空间分组在离线素材生成时完成，行驶帧不增加分组或补偿计算。清单中的 `leafClusters` 和 `leafArea` 分别记录叶簇数与米制贴片几何面积；后者不是屏幕可见覆盖率，更大的交叉叶片可能改变局部轮廓与叶片尺度，实际远景观感仍以游玩验收为准。
- 单独处理树叶贴片缩到几个像素时的覆盖流失：从原始叶片裁切轮廓生成共享 R8 覆盖图，mip 按面积平均，一直保留到 1×1；原有颜色图的粗 mip 仍可能低于 0.5 裁切阈值，仅补偿贴片几何面积无法避免整片消失。运行时按 UV 导数估算整张叶簇贴片的像素尺寸，在 12–4 像素之间从详细裁切过渡到平均覆盖率。小贴片用按深度和 UV 去相关的抖动覆盖，避免层叠叶片重复使用同一份 MSAA 样本掩码，继续由现有运动重投影 TAA 平滑；有 MSAA 时保留近处 Alpha to Coverage 和几何边缘抗锯齿。三个树种各共享一张 512×512 R8 图（含 mip 总计约 1 MiB），每个可见树叶片元增加一次覆盖图采样；不影响草和灌木。颜色仍从原有扩边图集读取，阴影深度继续使用原来的裁切图集和 LOD 过渡。

已从本地素材缓存重建，只有三份 far GLB 的内容变化，六份近中景 GLB 保持一致。橡树、梣树、松树远景整树三角形分别由 1453 / 1676 / 1110 降为 517 / 584 / 438。来源、许可和加工记录继续写入 `public/assets/vegetation/manifest.json`，运行时素材版本号已更新。使用 `node scripts/prepare-vegetation.mjs` 可重建。本次远景简化仅运行离线素材加工，没有运行构建、测试、自动浏览器验收、截图回归或性能基准。

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
