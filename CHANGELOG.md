# Changelog

## 0.3.2 - 2026-08-31

- 根据受信 CA 下的京东 15.10.50 实机日志，增加冷启动弹窗、首页“二楼”和游戏入口的精确拦截。
- 仅拦截钱包的营销入口查询；钱包首页、余额、登录、RSA 和支付接口保持不变。
- 不对 `api.m.jd.com`、`ms.jr.jd.com` 或京东通用素材域名做整域拦截。

## 0.3.1 - 2026-08-31

- 在总模块的 `[MITM]` 中显式启用 HTTPS 解密与 HTTP/2 MITM，避免切换配置后仅加载 hostname、运行隧道仍按 TCP 转发。
- 当前配置必须使用手机已安装并信任的 CA；仓库不嵌入证书或私钥。

## 0.3.0 - 2026-08-30

- 将 Core、Advanced、京东保守补丁和 System Extras 合并为一个远程订阅模块。
- 组件源保留在 `components/`，由确定性构建器去重生成 `modules/Gauss-AdClean.sgmodule`。
- 手机端只需维护一个订阅地址，继续复用现有 Shadowrocket CA。

## Core 0.2.1 - 2026-08-30

- 紧急移除 `www.google.com` 的 URL Rewrite 与 MITM hostname；常驻广告模块不得解密完整 Google 主站。

## 0.2.1 - 2026-08-30

- 建立 GitHub 远程订阅结构。
- 新增独立的京东保守补丁，只覆盖明确广告接口。
- 记录 TLS 1.3 抓包边界与短时代理日志流程。

## 0.2.0 - 2026-08-30

- Core、Advanced 与 System Extras 完成首轮本地审计和实机验证。
- 排除远程脚本、敏感认证域名及会员状态修改。
