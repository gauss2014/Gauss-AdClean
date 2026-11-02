# Shadowrocket旧模块审计摘要

## 2026-11-02 京东启动页修补

- 用户目标：启动 Logo 可保留，首页前双十一推广与倒计时不保留。
- 现有脚本只处理明文 JSON，且主 API 无查询参数及旧首页接口匹配不能覆盖全部启动请求。
  原拒绝规则未包含 `start/startup`。这些是本地核实的缺口，不等于本次手机漏拦根因已确认。
- 协议与字段线索来自
  [zbsdsb/loon-adblock-plugins](https://github.com/zbsdsb/loon-adblock-plugins/tree/890f64953efc870d4ca6cc5ec19b048c88ec73bb)：
  维护者记录 15.9.50+ 的 Base64 响应、隐藏 functionId，以及开屏 `images/showTimesDaily`。
  不是本用户新抓包；本仓库测试为合成结构，不冒充真实 HAR。
- 自行实现有界解码及清理，不加载第三方脚本，不采集请求正文。
  显式 start/startup 只清开屏图片及既有展示次数；未知接口必须同时有图片列表和有效展示次数。
  其他显式接口、未知结构、畸形编码透传，日志只记录修改次数及编码类型。
- 单一主 API 响应处理器避免重叠规则抢先命中，旧 UI 清理范围不扩大，钱包保留旧脚本版本。
  不根据“跳过”字眼作判断，不改 Logo 字段，不推测新计时字段，不增加整域拦截或 MITM 范围。
- 已缓存或内置推广仍需用户冷启动验证；不承诺 App 本身加载耗时消失。

## 2026-11-02 闲鱼开屏修补

- 接口及字段线索来自维护者
  [skernelx/SurgeScripts d98eba9](https://github.com/skernelx/SurgeScripts/commit/d98eba9d655b62440857c351c78b502c5a3068a8)：
  `idlecommerce.splash.ads/2.0` 的 `cacheAd/cacheAdInfo/dspList`，
  以及 `idleadv.scene.restore`、`idleadv.app.launch.report`。
  这是外部维护者的记录，并非本用户手机抓包结论。
- 本仓库独立实现有边界的响应清理，只操作指定开屏 API 的 data；
  不导入上游脚本、不伪造成功状态、不记录响应内容、不改会员权限。
- 对原广泛 URL 拒绝规则加入精确排除，防止它先拒绝请求而导致响应脚本永不执行。
  新增 MITM 目标只为 `gw.m.goofish.com`、`gw.m.taobao.com`、`h5api.m.goofish.com`。
- 回归覆盖缓存引用、旧版嵌套容器、未知/畸形输入、幂等、路径边界和业务接口。
  保留旧版本回退；本机无法替代 iPhone 的冷启动效果及交易功能验收。

审计对象：`Modules.zip`，SHA-256 `f12068f170932dce1ca3212dea050a8e7b92ec837526b371f375a9314b9afa39`。

## 总体结果

- 50个模块，共1806行配置。
- 720条URL改写、104条正文改写、205处远程脚本引用。
- 远程脚本共64个不同URL，20个模块依赖远程脚本。
- 644个MITM目标。
- 6个银行、金融或认证敏感模块未进入新版本。
- 6个会员解锁、定位修改或非广告模块未进入新版本。

## 主要风险

`APP启动页去广告`单个模块包含571条URL改写、164处远程脚本引用和540个MITM目标，其中有55个通配目标和23个裸IP。该模块同时扩大TLS解密范围、远程代码供应链和Network Extension资源占用，已整体排除。

所有远程JavaScript均未进入0.2.0。原模块中的银行、数字人民币、微信认证相关MITM规则也未进入0.2.0，避免广告过滤影响登录、支付和设备风控。

旧模块中还存在修改会员、NSFW显示、页面导航、定位和NFC行为的规则，不能按“去广告”口径继承。Advanced中的Reddit规则已重写为仅移除广告对象，不再修改NSFW状态。

## 0.2.0边界

- Core只包含静态拒绝与URL改写。
- Advanced包含人工筛选后的广告字段正文改写，以及从7个远程脚本模块中剥离出的静态广告规则；原远程脚本、HTTPDNS和非广告功能修改均未继承。
- Core和Advanced均无脚本；System Extras只有本地内联区域响应脚本。模块只使用本仓库的公开更新地址，不引用远程可执行脚本、CA材料或外部自动更新源。
- 未继承Spotify、NFC VIP、App Store收据伪造等会员状态修改。
- 当前完成的是静态语法和jq表达式校验；App端行为仍需在实际版本上逐项验证。

## 0.4.0 激进策略

- 经用户明确选择，四个购物/生活 App 改为去广告优先；不承诺保留推荐、活动、视频或支付兼容性。没有整域封锁共用 API、商品 CDN 或增加全局 MITM 通配。
- 闲鱼 `idlecommerce.splash`、京东 `lite_advertising/homeAreaPop`、广告素材目录参考维护者[公开规则](https://github.com/huijingfei/shadowrocket/blob/main/sr_app_ad.conf)。只人工提取接口线索，没有导入其配置、证书、DNS、分流或脚本。
- 新增网关/path 变体和广告语义段匹配是本项目主动扩大覆盖的策略，并非宣称在本机抓包观察到所有变体；美团路径亦结合此前保留的静态规则。
- 0.3.4引入的本仓库固定版本响应脚本保持不变。离线测试只证明样例匹配、作用域和构建一致性，手机冷启动效果仍须实测。
