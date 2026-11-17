# QX 在线规则

## 一次接入

保留手机当前节点、HK/US 策略组、DNS 设置和已信任证书。不要用公开文件覆盖整份配置。

1. 在「分流资源」添加总分流，开启「插入资源」，关闭资源解析器，不强制指定统一策略。

   https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/rules/Gauss-Routing-QX.list

2. 在「重写资源」添加总重写，关闭资源解析器。

   https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-All-QX.snippet

3. 停用旧 Gauss-Ads 分流及旧 Apps、YouTube、UMP TEST 重写资源，避免旧规则抢先匹配。总分流包含原基础分流及末尾兜底，插入资源使其先于旧本地分流。
4. 更新两个资源并重连一次 QX，然后重发微信图片。后续只更新这两个入口。

`QuantumultX-online-resources.conf` 提供可替换对应两个区段的原生配置，自动更新间隔一小时。它是配置片段，不是完整配置。

## 覆盖与状态

- 原基础分流整体保留，已测试的 ChatGPT/Gemini 美国出口及 Apple/天气直连优先于通用广告拦截。其他未匹配流量仍走 HK。
- 微信增加 42 条社区域名/UA 直连规则，排除其 HTTPS 解密，并移除微信文章广告重写。微信传图当前是“关 QX 成功、开 QX 失败、单停广告分流无效”；本轮兼容调整的实机恢复情况待确认，不把它当已定位根因。
- 微信列表来自 blackmatrix7/ios_rule_script；未采用其整段 Tencent ASN 直连，避免影响其他云上业务。
- 其他应用重写保留。YouTube 纳入当前纯本地 UMP beta2，用户仍报告倒计时广告，在线整合本身没有解决这个问题。没有使用第三方播放解密 Worker。
- 规则和脚本都由远程资源维护；节点凭据、证书、DNS/全局开关是 QX 本机配置，不放公开仓库。普通规则订阅无法远程修改这些全局设置。

## 维护

修改原 Apps/YouTube 资源或 `components/qx-online/base-routing.list` 后执行：

```sh
python3 tools/build_qx_online.py
python3 tools/test_qx_online.py
python3 tools/test_qx_apps.py
```

发布更新后的两个总入口。脚本继续使用固定版本 URL；更新总重写中的版本引用即可分发新脚本，不篡改旧 tag。

依据：
- https://github.com/crossutility/Quantumult-X/blob/master/filter.snippet
- https://github.com/crossutility/Quantumult-X/blob/master/sample.conf
- https://github.com/blackmatrix7/ios_rule_script/blob/master/rule/QuantumultX/WeChat/WeChat.list
