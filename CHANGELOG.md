# Changelog

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
