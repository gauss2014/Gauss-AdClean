# Gauss AdClean

自维护的 Shadowrocket 去广告模块。规则来自历史实测和公开规则维护者的接口线索；新增规则的离线测试不代表手机端已验证。仅引用本仓库固定版本的响应脚本，不包含 CA、私钥、Cookie、抓包或会员状态伪造。

## 0.4.3 闲鱼开屏传输补漏

补齐闲鱼及其淘宝兼容网关的UDP/443拒绝，让HTTP/3请求回落到可执行MITM改写的TCP。
仅覆盖现有开屏脚本使用的10个精确网关，不屏蔽整个淘宝/闲鱼域名，不限制其他网站QUIC。
既有开屏主接口、预取接口和缓存广告响应清理保留；京东规则不变。
接口依据：https://github.com/Thelongdarkorg/loon-plugins/blob/main/xianyu_splash_ad_block.plugin 。
这是已确认的规则覆盖缺口；本次没有手机抓包，尚不能认定它就是所有漏拦的原因。
刷新模块到0.4.3、重新连接，再完全退出并打开闲鱼。沿用手机现有受信CA，不重签证书。

## 宿主机同款分流

独立配置入口：[Host-HK-AI-US.conf](configs/Host-HK-AI-US.conf)。节点通过私人文件导入，仓库不存节点凭据。
普通境外流量走香港，AI及Amazon走美国DMIT，国内、内网和Apple直连；IPv6兜底沿用宿主机的美国出口。
`rules/host-cn.list`和`rules/host-ads.list`来自2026-11-10宿主机正在使用的规则快照。
选用该配置后，将上述去广告模块启用并沿用原有受信证书。原配置和节点保留，可随时切回。

## 0.4.2 京东开屏修补

目标是保留正常启动 Logo，清理首页前的开屏推广，包括没有“广告”字样的促销页。
补充 `start/startup` 响应清理和 Base64 JSON 兼容：只清空已知开屏的 `images`，
将既有 `showTimesDaily` 置零，保留 Logo、设备配置和其他字段。
URL 未给出接口名时，必须同时符合这两个开屏字段特征；不按“跳过”文字或通用图片字段误删。
旧版 UI 清理维持原范围，钱包脚本仍固定在旧版本；不增加 MITM 域名。

刷新原模块到 `0.4.2`，重新连接后完全退出并重开京东。
`[GAUSS-JD-SPLASH] changed=N` 表明脚本修改了开屏响应；目前只有离线验证，
未在用户手机抓到本次双十一页面。已有本地缓存或客户端内置页面仍可能展示，
不能承诺仅靠网络规则消除一切启动等待。
回退地址：https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.1/modules/Gauss-AdClean.sgmodule

## 0.4.1 闲鱼开屏修补

新增闲鱼专用响应脚本，清理新版开屏接口中的 `cacheAd`、`cacheAdInfo`、
`dspList` 和已知广告容器，同时补齐广告场景恢复接口。仅处理开屏专用响应，
保留原有协议状态和其他字段；非 JSON 或未知结构透传。脚本固定到本仓库
`v0.4.1`，不直接执行第三方脚本。离线回归通过不代表手机已去除开屏广告。

刷新模块后确认版本为 `0.4.1`，重新连接小火箭，再冷启动闲鱼。
日志出现 `[GAUSS-XY-SPLASH] changed=N` 且 N 大于 0，才证明响应发生修改；
如果仍展示广告，需排查缓存、MITM 是否生效或新的接口，不能直接归因。
回退地址：https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.0/modules/Gauss-AdClean.sgmodule

## 既有去广告策略

闲鱼、淘宝、京东、美团采用激进拦截：开屏和弹窗优先，同时阻断部分推荐、营销图片及视频素材。推荐页、商品活动、视频预览等功能可能缺失，支付流程也不保证兼容；需要时可临时停用模块。

本次不修改代理节点、分流、DNS或现有证书。刷新原订阅并重新连接，再完全退出目标 App 后冷启动；仅刷新模块不需要重新签证书。已下载的广告缓存可能仍展示，当前 App 若更换接口也可能漏拦，不能保证所有开屏都消失。

## 订阅地址

在 Shadowrocket 中进入 `配置 -> 模块 -> +`，添加唯一订阅链接：

- `https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-AdClean.sgmodule`

手机只需启用这一项。以后更新时，在 Shadowrocket 的模块页面刷新远程模块即可，不需要重新传文件。若当前配置重新生成了 CA，仍须在 iOS 中重新安装并信任该证书。

## HTTPS 解密

包含 `[MITM]` 的规则需要在当前 Shadowrocket 配置中开启 HTTPS 解密，并使用手机已经安装和信任的 Shadowrocket CA。CA 信任按证书区分；切换到重新签发 CA 的配置后必须重新安装并信任。仓库不会提供、接收或保存 CA 私钥。

## 反馈流程

发现漏拦时提供 App 版本、页面、操作顺序、复现时间和短时代理日志：

1. `数据 -> 代理 -> 启用日志记录`。
2. 清理旧日志，只复现目标 App 20 至 30 秒。
3. 导出代理日志；日志会显示完整请求 URL，MITM 请求会标记为 `MITM`。
4. 不在登录、支付或私聊页面复现，不提交 Cookie、Authorization 或请求正文。

普通 PCAP 只能可靠观察 DNS、SNI、IP、时序和流量；TLS 1.3/ECDHE 会话不能通过事后补交 CA 证书解密。需要接口 URL 时，应在抓取当时启用定向 MITM。

## 仓库结构

- `components/`：Core、Advanced、京东补丁和系统实验层的维护源，旧文件名为订阅兼容而保留。
- `modules/Gauss-AdClean.sgmodule`：由构建器去重生成的唯一订阅模块。
- `tools/build_module.py`：确定性构建器；CI 会拒绝未重新生成的旧产物。

规则更新先做匹配与作用域测试，再发布到上述单模块。0.4.0起去广告优先，不以保住所有 App 功能为合并前提；整域断网、分流和证书变更不混入去广告更新。完整审计见 [AUDIT.md](AUDIT.md)。
