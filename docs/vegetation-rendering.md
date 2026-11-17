# 实时地被与灌木方案

当前覆盖范围：立体草仅生成在赛道护栏的赛道侧，包含路面与护栏之间的草地。使用护栏生成器同一份铺装外扩距离场，并扣除草片实际半径；内侧围栏后的内场和外侧围栏后的环境不再生成草片。树木和灌木仍作为环境植被保留。围栏外地面使用同一草皮 PBR，叠加非周期的多尺度草簇、长势、少量干草色差及粗糙度变化，不增加立体草或碰撞。

原草簇的问题是宽三角形叶片、单一亮色和孤立分布；原灌木直接复用了缩小的树冠。现在使用带真实叶形、UV 和摄影贴图的植物素材。

## 方案来源

- [NVIDIA GPU Gems：草丛渲染](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-7-rendering-countless-blades-waving-grass)：把叶片细节交给贴图和草簇、批量绘制、只对上部施加风动、远距离退出。
- [NVIDIA GPU Gems 3：SpeedTree 渲染](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-4-next-generation-speedtree-rendering)：双面叶片光照、Alpha to Coverage、植被 LOD 过渡。
- [Three.js Material 文档](https://threejs.org/docs/pages/Material.html)：使用 alphaTest、alphaToCoverage 与深度写入，保留叶片轮廓并减少透明排序问题。Alpha to Coverage 的边缘平滑依赖 MSAA；距离过渡另用互补抖动裁切，不依赖透明混合。
- [Poly Haven 许可](https://polyhaven.com/license)：资源以 CC0 提供，允许修改与随项目分发。项目使用原始模型，不依赖在线植物生成服务。
- [Bridson：Fast Poisson Disk Sampling](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)：蓝噪声、最小间距与空间邻域查询的依据。这里运行时采用世界坐标哈希候选加优先级邻域剔除，离线草片采用渐进最远候选布局，并非逐字移植 Bridson 的活动列表算法。
- [Epic：Two Sided Foliage](https://dev.epicgames.com/documentation/unreal-engine/shading-models-in-unreal-engine)：普通材质缺少透光时叶背会过黑，薄叶需要专用双面透射处理。
- [Crytek：Crysis 植被着色](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)：低成本的薄叶散射近似，配合半球天光和受阴影约束的背光透射。
- [GTA V 帧分析](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/) 与 [GTA V 植被图集分析](https://www.adriancourreges.com/blog/2017/05/09/beware-of-transparent-pixels/)：这是作者对实际帧和图集的分析，能够参考植被分类、距离处理和透明像素颜色扩边；不能据此声称已确认或复刻 Rockstar 的完整草地散布算法。
- [Epic：Open World Tools Tips](https://dev.epicgames.com/documentation/unreal-engine/open-world-tools-tips-in-unreal-engine)：同一控制遮罩可以驱动草的生成及地表混合。这里把实际道路边界距离和多尺度噪声组合成密度/高度遮罩，统一约束独立草簇与大草片。

## 本项目采用的素材

| 来源 | 游戏中的用途 |
| --- | --- |
| [Grass Medium 01](https://polyhaven.com/a/grass_medium_01) | 两种低矮草丛 |
| [Grass Medium 02](https://polyhaven.com/a/grass_medium_02) | 两种较高的杂草 |
| [Shrub Sorrel 01](https://polyhaven.com/a/shrub_sorrel_01) | 两种低矮小叶植物 |
| [Shrub 02](https://polyhaven.com/a/shrub_02) | 两种小灌木 |

离线处理保留原有叶形与 UV，移除素材展示用的横向排列位移，将根部归零，统一米制尺寸，生成近、远两级网格。每套摄影漫反射图合入对应 Alpha，输出 1024px RGBA；GL 法线和 AO/粗糙度/金属度为 512px。

大面积草地另使用 Grass Medium 01 原作者图集中现成的整簇草叶图像，从 4K 原图裁切、分离相邻的独立叶片并去掉透明空白，打包为共享的 1024×512 RGBA/法线图集。两种约 2.4 米宽的密集草片，近景每片 36 簇、432 三角形，远景每片 24 簇、144 三角形。远景根位置是近景布局的子集；每簇有不同的朝向、宽高、贴图镜像和轻微颜色变化。整包共 20 个 LOD 网格，约 1.72 MiB。RGBA 直接按像素合入透明通道，防止延迟执行的图像处理操作移除新加入的 Alpha。

来源链接、原始文件 MD5、处理后高度和三角形数记录在 `public/assets/vegetation/groundcover-manifest.json`。使用 `pnpm assets:groundcover` 重建，下载缓存位于被 Git 忽略的 `test-results/asset-source/groundcover`，该目录仅用作素材缓存，不运行测试。

## 运行时策略

- 按植物种类与 24 米空间单元实例化。近远模型共享实例位置和贴图。
- 全地形的可种植区域都有密集草片，不再限制在赛道附近。按世界坐标确定随机种子，视点移动后重新访问同一区域时，布局保持一致。
- 草片锚点采用有最小间距的哈希候选筛选，跨分块查询同一套邻居；移除 2.4 米方格的小幅抖动排列。草片自由旋转 0–360°，横纵宽度、高度、色调分别变化，生长起伏改用非周期的多尺度值噪声。草片内部也移除 6×6 / 4×4 阵列，改为渐进蓝噪声候选布局。
- 大面积草片在 16–32 米之间切换近远模型，约 81–136 米逐渐淡出。每簇草使用独立的根位置和高度权重，在顶点着色器中采样同一份地形高度；三角插值和地形网格相同，草片内部也能贴合坡地。
- 以视点为中心预加载约 168 米范围内的 24 米分块，优先最近分块，首轮最多处理 12 块，之后每帧最多 6 块。224 米外的缓存块释放实例缓冲和派生材质；共享模型、图集保留。地图很大时不一次生成整张地图的草叶。
- 新分块用半秒渐显，距离剔除与 LOD 继续使用互补抖动过渡。靠近路面、岸线和设施时，放不下完整草片的位置尝试约三分之一大小的草片。
- 草在 12–24 米之间过渡至低细节模型；小叶植物为 15–28 米；灌木为 30–52 米。
- 草在约 41–96 米内逐渐隐去；小叶植物约 51–105 米；灌木约 123–195 米。每株加入少量距离偏移，避免形成同一圈边界。
- 网格 LOD 使用同一屏幕噪声的互补裁切；完整淡出之后再剔除空间单元。CPU 剔除按实例锚点范围计算，不用有形状差异的 LOD 中心代替植物位置。
- 叶面保留摄影色彩、法线和粗糙度；双面天空光按正面 0.62、背面 0.38 混合，背面包含真实 HDR 与半球光照。直接日光使用包裹漫反射和薄叶背光散射近似，仍受太阳阴影约束。环境反射强度为 0.6，AO 强度由 0.65 降至 0.28，根部额外衰减由 0.78 放宽至 0.96；未修改全场曝光，也未使用发光材质伪装补光。
- 地被与树叶摄影图集在导入时把可靠叶色扩展到整个透明背景，覆盖低 Alpha 的偏白污染；在线性光下按预乘 Alpha 降采样，每级单独修正透明覆盖率，不把修正后的 Alpha 递归滤入下一级。最终 mip 链用原始 RGBA DataTexture 上传，保留 Alpha 为零处的叶色。草和树叶共用有宽度上限的 MSAA 裁切，避免斜视时空白图集也获得覆盖。所有实例共享导入结果，详见 [白边修正](daylight-and-canopy.md#草与树叶白边修正)。
- 路边单簇草的纵向采样间距从约 0.85 米缩至 0.65 米，每处候选从 8 簇增至 12 簇，另外保留高草、小叶植物和真实灌木。全地形草片使用实际模型半径排除道路、路肩、缓冲区、水面、围场及看台占地。真实赛道和手绘赛道使用同一套生成逻辑。
- 路缘增加三级随机细节：约 2–5 厘米的贴地短草、后方稀疏普通草、再后方较完整的草簇。实际路面/路肩/缓冲区并集距离叠加两尺度噪声，在约 4 米范围渐变；不按中心线或固定偏移画一条新草带。
- 靠近道路的每个 24 米分块生成一张共享的 32×32 R8 密度遮罩，含 4 米边缘覆盖，采样点对齐世界坐标。每簇草在自己的根位置读取遮罩，独立调低高度与保留概率，因此大草片朝向道路的一侧也能变矮、变疏。窄小补片的高度同时随缩放降低，不再形成高而密的小草墙。遮罩随分块卸载释放。
- 不增加碰撞体，不给每片草叶增加动态投影；接收现有日光阴影并使用素材 AO。模型、贴图共享，场景重建时释放实例缓冲与派生材质。

执行了素材下载与离线加工，以及 TypeScript 无输出编译。没有运行测试、自动浏览器验收、截图回归或性能基准。实际观感和驾驶性能由游玩验收。
