# Changelog

## 0.4.1 - 2026-11-02

- Handle exact Xianyu splash APIs with a version-pinned first-party response
  script instead of rejecting them before response cleanup.
- Clear known cacheAd/cacheAdInfo/dspList and nested advertising containers;
  preserve response envelopes and unknown fields. Malformed input passes through.
- Add exact advertising scene-restore, launch-report and exposure endpoints,
  plus explicit gw/h5api gateway coverage. No gateway-wide reject or MITM wildcard.
- Keep other apps, existing JD script, routing, DNS and certificates unchanged.
- Add response-fixture, reject/script precedence, MITM coverage and business-path
  regression tests. Phone-side cold-start acceptance remains pending.

## 0.4.0

- Fix query-order dependence for the existing JD splash endpoints.
- Aggressively block Xianyu MTOP splash, popup and marketing endpoints, including
  idlecommerce.splash, across gateway variants; sacrifice recommendation feeds.
- Extend Taobao advertising endpoints and block creative/video asset paths.
- Block Meituan startup/appstatus paths even without an ad query parameter,
  and broaden named advertising asset paths across image and video formats.
- Add JD lite_advertising/homeAreaPop and promotional asset paths. App features,
  including recommendations, video and promotional product images, may break.
- Add offline matching regression cases. These cases do not establish the cause
  of the latest phone-side regression; current cold-start logs are still needed.
- Do not change proxy routing, DNS or the CA. Keep the existing version-pinned
  first-party response script; no new remote executable dependency is added.

## 0.3.5 - 2026-09-01

- 恢复淘宝、京东、闲鱼和美团主应用的精确开屏广告接口，修复停用旧启动页大合集后开屏广告回归。
- 闲鱼同时覆盖`acs`与`g-acs`网关；美团仅增加主站开屏路径，不拦截订单、账号或支付接口。
- 继续拒绝旧模块中的第三方远程脚本、广域MITM和金融认证规则。

## 0.3.4 - 2026-08-31

- 将京东15.10.50精简逻辑从手机端未生效的JQ正文重写切换为已实证可执行的响应脚本。
- 脚本仅处理实测首页、游戏和钱包字段，并记录脱敏修改计数，便于区分规则未执行、已修改但客户端缓存或入口由客户端写死。
- 仅允许加载本仓库`main/scripts/`下的审计脚本，校验器继续拒绝其他远程脚本、证书和敏感配置。

## 0.3.3 - 2026-08-31

- 根据京东15.10.50响应结构实测，以本地JQ正文改写删除游戏列表、钱包借贷、钱包弹窗/悬浮营销和首页直播层。
- 移除已确认只能造成“入口仍在、内容失效”的游戏与钱包静态拒绝规则。
- 保留订单、商品、资产、账单、充值、登录、RSA和支付链路；不使用外部JavaScript。

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
