# QX 其他应用去广告

沿用原 Core、Advanced、JD-Conservative 三个组件和已有广告域名列表。
不包含 YouTube；已经添加的 YouTube QX 资源继续保留。

## 添加两条资源

**重写 → 引用/资源 → 添加：**

https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-Apps-QX.snippet

**分流 → 引用/资源 → 添加：**

https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/rules/Gauss-Ads-QX.list

两条资源均关闭资源解析器。广告分流开启“插入资源”，策略使用资源自带的 reject。
若使用配置编辑器，仅在现有 `[filter_remote]` 段增加这一行，不要覆盖整份配置：

```ini
https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/rules/Gauss-Ads-QX.list, tag=Gauss-Ads, inserted-resource=true, opt-parser=false, enabled=true
```

重写资源自带所需解密域名。保留手机已安装的证书、现有节点和 AI 分流。

## 内容与验证

- 908 条广告域名/IP 拦截，122 条应用重写，82 个解密域名。
- 京东、闲鱼、淘宝、美团、微博、知乎、微信文章、网易云、爱奇艺、Keep、瑞幸、12306 等原规则保留。
- 原本已批准的首页推荐、直播/营销入口隐藏继续保留；不是仅删除开屏。
- 58 项 jq 正文操作按接口合并成 13 条，确保同接口处理完整。
- 京东主 App、京东金融钱包、闲鱼分别复用原固定版本脚本；钱包没有误换成仅主 App 版本。
- 拼多多两条 IP 广告规则保留 URL 与 User-Agent 联合条件，未扩大到其他应用。
- 原闲鱼 UDP 回退由 QX MitM 处理，不添加全局 UDP 屏蔽。
- 未加入此前暂缓的 NFC、AdGuard、adultraplus，也未恢复 Apple 地区改写。
- 脚本在手机本地执行，无运行时网络请求。手机端效果需逐应用测试。

回退时停用这两条新增资源，不用删除基础配置或证书。

格式依据：[QX 官方示例](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)。
完整转换统计见同目录 `QuantumultX-apps-coverage.json`。
