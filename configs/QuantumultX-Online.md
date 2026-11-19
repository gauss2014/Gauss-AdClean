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
- 微信保留 42 条域名/UA 直连规则。公众号域名 mp.weixin.qq.com 单独参与 HTTPS 解密，仅清理 /mp/getappmsgad 的广告列表和计数。聊天、传图、支付域名不参与此次解密。
- 微信列表来自 blackmatrix7/ios_rule_script；未采用其整段 Tencent ASN 直连，避免影响其他云上业务。
- B 站青少年模式启动提醒：保留上游 BiliUniverse/ADBlock v0.6.19 的 Teenagers/ModeStatus 作为候选。其字段仅标作 f5.f1，尚无仅控制启动弹窗的验证；当前订阅让该响应原样通过。
- YouTube 的列表、搜索、播放、Shorts、导航和设置由固定版本的本地响应脚本处理；包含画中画、后台播放和简中字幕选项。字幕复用 YouTube 字幕轨道，脚本没有联网接口。Googlevideo 播放流保留原 UMP beta2 处理。离线通过；iOS 倒计时广告效果待实测。总订阅不改全局 UDP 设置。
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
