# YouTube UMP 本地测试版

## 导入

1. 停用旧的 **Gauss YouTube QX**，以及其他 YouTube 重写；其他应用去广告、分流保持原样。
2. 在 QX 的重写资源添加下面地址，资源解析器关闭，保持重写、MitM 开启。

```text
https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-YouTube-UMP-QX-TEST.snippet
```

3. 更新资源，彻底退出 YouTube 后重新打开，先打开首页，再播放之前会出现倒计时广告的视频。

这是独立重写资源，不是完整配置；不导入节点，也不替换已有证书。

## 本版改动

- 在本机从 config/log_event 响应提取播放密钥，按有效期保留最近 8 个密钥。
- 在 initplayback 响应内处理 UMP type 0/type 25 加密元数据，支持无压缩、gzip、Brotli。
- 本地验 HMAC、解密、删广告字段、重新加密和封包；音视频分块不解码、不修改。
- 保留已有 API 列表广告过滤，不修改后台播放、画中画、字幕、普通 Shorts 或会员状态。
- 脚本无运行时网络请求，不调用 Worker，不外发播放 URL、Cookie 或密钥。脚本资源仍由 GitHub 下载。
- 保持 2 MiB 处理上限。缺密钥、认证不通过、不支持的封包或超过上限时原样放行。

本地通知和 QX 日志中的结果：`KEY_READY` 表示取得密钥；`UMP_FILTERED` 表示这一次实际删除了 UMP 内的广告字段；`API_FILTERED` 表示 API 响应过滤；`KEY_MISSING`/`KEY_MISMATCH`/`SIZE_SKIP`/`PARSE_BYPASS` 表示本次原样放行。通知按版本和结果各显示一次；日志始终记录，不包含具体 URL、正文、密钥。

## 验证状态

21 项离线测试通过，包含实际发布运行代码的 QX 接口模拟、两种 UMP 包及三种压缩、Node crypto/zlib 独立验回、未知字段及音视频保留、密钥轮换和错误放行。测试使用合成协议数据，手机实机效果待测。

若 Googlevideo 流量仍是 QUIC/UDP 而未进入 HTTPS 重写，可在主配置已有 `[general]` 段添加或合并 `udp_drop_list = QUIC`。这是整个 QX 隧道的 QUIC 回退设置，会影响其他 App 的 HTTP/3，不是本资源自动修改项；不要再建第二个 `[general]` 段。

出现转圈或播放故障时停用这个测试资源即可回退。正式版订阅没有被替换。

## 源码与构建

`components/youtube-ump/` 内保留源文件、依赖锁、固定上游和测试：

```sh
cd components/youtube-ump
npm ci --ignore-scripts --no-audit --no-fund
node build-runtime.cjs
node test-runtime.cjs
```

使用 Maasea protobuf schema/ad-only adaptation、LuanRT/googlevideo UMP reader/writer、noble AES/HMAC、fflate 和 brotli.js。协议依据：

- https://github.com/davidzeng0/innertube/blob/main/googlevideo/initplayback.md
- https://github.com/davidzeng0/innertube/blob/main/googlevideo/ump.md
- https://github.com/LuanRT/googlevideo

重新加密采用 HMAC 派生的 128-bit IV，输入包含专用域分隔串、原 IV 和修改后压缩数据的 SHA256；不复用原 IV，不用 Math.random。读取端按协议验证 ciphertext||IV 的 HMAC。Brotli 元数据修改后输出 gzip，并同步更新协议的压缩枚举。
