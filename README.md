# Gauss AdClean

自维护的 Shadowrocket 去广告模块。规则来自本地审计和实机验证，不包含 CA、私钥、Cookie、抓包、远程 JavaScript 或会员状态伪造。

## 订阅地址

在 Shadowrocket 中进入 `配置 -> 模块 -> +`，添加唯一订阅链接：

- `https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-AdClean.sgmodule`

手机只需启用这一项。以后更新时，在 Shadowrocket 的模块页面刷新远程模块即可，不需要重新传文件或重装证书。

## HTTPS 解密

包含 `[MITM]` 的规则需要在当前 Shadowrocket 配置中开启 HTTPS 解密，并使用手机已经安装和信任的 Shadowrocket CA。仓库不会提供、接收或保存 CA 私钥。

## 反馈流程

发现漏拦时提供 App 版本、页面、操作顺序、复现时间和短时代理日志：

1. `数据 -> 代理 -> 启用日志记录`。
2. 清理旧日志，只复现目标 App 20 至 30 秒。
3. 导出代理日志；日志会显示完整请求 URL，MITM 请求会标记为 `MITM`。
4. 不在登录、支付或私聊页面复现，不提交 Cookie、Authorization 或请求正文。

普通 PCAP 只能可靠观察 DNS、SNI、IP、时序和流量；TLS 1.3/ECDHE 会话不能通过事后补交 CA 证书解密。需要接口 URL 时，应在抓取当时启用定向 MITM。

## 仓库结构

- `components/`：Core、Advanced、京东保守补丁和系统实验层的维护源。
- `modules/Gauss-AdClean.sgmodule`：由构建器去重生成的唯一订阅模块。
- `tools/build_module.py`：确定性构建器；CI 会拒绝未重新生成的旧产物。

规则更新遵循单 App、可独立停用、先验证核心功能再合并的原则。完整审计见 [AUDIT.md](AUDIT.md)。
