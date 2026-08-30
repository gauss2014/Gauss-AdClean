# Gauss AdClean

自维护的 Shadowrocket 去广告模块。规则来自本地审计和实机验证，不包含 CA、私钥、Cookie、抓包、远程 JavaScript 或会员状态伪造。

## 订阅地址

在 Shadowrocket 中进入 `配置 -> 模块 -> +`，分别添加需要的链接：

- 核心版：`https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-AdClean-Core.sgmodule`
- 增强版：`https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-AdClean-Advanced.sgmodule`
- 京东保守补丁：`https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-JD-Conservative.sgmodule`
- 系统功能实验层：`https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-System-Extras.sgmodule`

建议常驻启用 Core，需要时再启用 Advanced 和单 App 补丁。System Extras 属于实验功能，应独立启停。

以后更新时，在 Shadowrocket 的模块页面刷新远程模块即可，不需要重新传文件。

## HTTPS 解密

包含 `[MITM]` 的规则需要在当前 Shadowrocket 配置中开启 HTTPS 解密，并使用手机已经安装和信任的 Shadowrocket CA。仓库不会提供、接收或保存 CA 私钥。

## 反馈流程

发现漏拦时提供 App 版本、页面、操作顺序、复现时间和短时代理日志：

1. `数据 -> 代理 -> 启用日志记录`。
2. 清理旧日志，只复现目标 App 20 至 30 秒。
3. 导出代理日志；日志会显示完整请求 URL，MITM 请求会标记为 `MITM`。
4. 不在登录、支付或私聊页面复现，不提交 Cookie、Authorization 或请求正文。

普通 PCAP 只能可靠观察 DNS、SNI、IP、时序和流量；TLS 1.3/ECDHE 会话不能通过事后补交 CA 证书解密。需要接口 URL 时，应在抓取当时启用定向 MITM。

## 模块边界

- `Core`：低风险、适合常驻的静态拒绝规则。
- `Advanced`：覆盖更多 App，包含经过筛选的正文改写。
- `JD Conservative`：只拦截京东语义明确的广告接口，不整域屏蔽支付、登录、金融首页、图片或视频 CDN。
- `System Extras`：Apple Geo 区域响应实验，不属于广告模块。

规则更新遵循单 App、可独立停用、先验证核心功能再合并的原则。完整审计见 [AUDIT.md](AUDIT.md)。
