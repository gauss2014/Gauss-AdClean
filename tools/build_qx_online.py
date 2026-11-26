#!/usr/bin/env python3
"""Build two credential-free QX resources from the retained routing snapshot."""
import argparse
import fnmatch
import ipaddress
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'components/qx-online'
BASE_URL = 'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/'
APPLE_DIRECT_SUFFIXES = ('apple.com', 'apple.com.cn', 'cdn-apple.com')
CAINIAO_LEGACY = {
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.adkeyword\.get url reject-dict',
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.nbpresentation\.(homepage\.merge|tabbar\.marketing)\.get url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.cainiao\.adx\.flyad\.getad url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
    r'^https?:\/\/netflow-mtop\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
}
# Legacy rules from Gauss-Apps-QX.snippet that are shadowed by cleaner later rules
# or overly aggressive for daily QX usage (e.g. Taobao product video playback).
QX_DROPPED_REWRITES = CAINIAO_LEGACY | {
    # Superseded by cleaner www|wmapi reject-dict and s3plus|flowplus reject-200 rules.
    r'^https?:\/\/s3plus\.meituan\.net\/v\d\/mss_\w+\/goku\/(lottie|lucency) url reject-img',
    r'^https?:\/\/wmapi\.meituan\.com\/api\/v\d+\/(loadInfo|openscreen|startpicture) url reject',
    # Strictly subsumed by the general Taobao MTOP and volvo/newface rules above them.
    r'^https?:\/\/acs\.m\.taobao\.com\/gw\/mtop\.alibaba\.advertisementservice\.getadv url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.taobao\.wireless\.home\.splash\.awesome\.get(?:\/|\?|$) url reject-dict',
    r'^https?:\/\/acs\.m\.taobao\.com\/gw\/mtop\.alibaba\.aicloud\.splash(?:\/|\?|$) url reject-dict',
    r'^https?:\/\/acs\.m\.taobao\.com\/gw\/mtop\.o2o\.ad\.gateway\.get url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.taobao\.(volvo\.secondfloor\.getconfig|wireless\.home\.newface\.awesome\.get) url reject-dict',
    # Overly broad: blocks normal Taobao product video previews/playback.
    r'^https?:\/\/cloud\.video\.taobao\.com\/(?:vod|play)\/ url reject-200',
}
QX_DROPPED_MITM_HOSTS = {'cloud.video.taobao.com'}
# Narrow JD main API script trigger to handled functionIds or queryless/hidden-functionId
# calls, and unify wallet cleanup onto the same pinned v0.4.2 script.
QX_REWRITE_REPLACEMENTS = {
    (
        r'^https?:\/\/api\.m\.jd\.com\/(?:client\.action|api)(?:\?[^#]*)?$'
        ' url script-response-body '
        'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.2/scripts/jd-response-cleanup.js'
    ): (
        r'^https?:\/\/api\.m\.jd\.com\/(?:client\.action|api)'
        r'(?:\?(?:(?:[^&#]*&)*functionId=(?:start|startup|welcomeHome|personinfoBusiness|getTabHomeInfo)(?:&[^#]*)?'
        r'|(?!(?:[^&#]*&)*functionId=)[^#]*))?$'
        ' url script-response-body '
        'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.2/scripts/jd-response-cleanup.js'
    ),
    (
        r'^https?:\/\/ms\.jr\.jd\.com\/gw2\/generic\/'
        r'(MyWalletS\/newh5\/m\/(myWalletIndex|myWalletIndexAsyncData)'
        r'|wealth-marketing-component\/h5\/m\/walletEntryQuery'
        r'|jkActivity\/newh5\/m\/queryDeliveryChannelInfo)(?:\?|$)'
        ' url script-response-body '
        'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.3.4/scripts/jd-response-cleanup.js'
    ): (
        r'^https?:\/\/ms\.jr\.jd\.com\/gw2\/generic\/'
        r'(MyWalletS\/newh5\/m\/(myWalletIndex|myWalletIndexAsyncData)'
        r'|wealth-marketing-component\/h5\/m\/walletEntryQuery'
        r'|jkActivity\/newh5\/m\/queryDeliveryChannelInfo)(?:\?|$)'
        ' url script-response-body '
        'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.4.2/scripts/jd-response-cleanup.js'
    ),
}


def active(text):
    return [s.strip() for s in text.splitlines()
            if s.strip() and not s.lstrip().startswith(('#', ';', '//'))]


def capture_routing(path):
    section = None
    rules = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith('['):
            section = line
        elif section == '[filter_local]' and active(line):
            rules.append(line)
    assert rules and rules[-1] in {'final, HK', 'final, US'}
    rules[-1] = 'final, US'
    validate_filters(rules)
    (SOURCE / 'base-routing.list').write_text('\n'.join(rules) + '\n')


def validate_filters(rules):
    kinds = {'host', 'host-suffix', 'host-keyword', 'host-wildcard',
             'ip-cidr', 'ip6-cidr', 'geoip', 'user-agent', 'final'}
    for line in rules:
        fields = [s.strip() for s in line.split(',')]
        assert fields[0] in kinds, fields[0]
        policy = fields[1] if fields[0] == 'final' else fields[2]
        assert policy in {'US', 'HK', 'direct', 'reject'}, policy
        assert len(fields) == (2 if fields[0] == 'final' else 3) or (
            len(fields) == 4 and fields[-1] == 'no-resolve')


def is_subdomain_of(domain, suffixes):
    value = domain.lower()
    return any(value == s or value.endswith('.' + s) for s in suffixes)


def optimize_filters(rules):
    """Drop unreachable filter rules shadowed by earlier exact/suffix/CIDR matches."""
    optimized = []
    seen_exact = set()
    seen_suffixes = set()
    seen_v4 = []
    seen_v6 = []
    for line in rules:
        fields = [s.strip() for s in line.split(',')]
        kind = fields[0]
        if kind == 'final':
            optimized.append(line)
            continue
        value = fields[1]
        key = (kind, value.lower())
        if key in seen_exact:
            continue
        if kind in {'host', 'host-suffix'}:
            labels = value.lower().split('.')
            if any('.'.join(labels[i:]) in seen_suffixes for i in range(len(labels))):
                continue
            if kind == 'host-suffix':
                seen_suffixes.add(value.lower())
        elif kind == 'ip-cidr':
            net = ipaddress.IPv4Network(value, strict=False)
            if any(net.subnet_of(prev) for prev in seen_v4):
                continue
            seen_v4.append(net)
        elif kind == 'ip6-cidr':
            net = ipaddress.IPv6Network(value, strict=False)
            if any(net.subnet_of(prev) for prev in seen_v6):
                continue
            seen_v6.append(net)
        seen_exact.add(key)
        optimized.append(line)
    return optimized


def render():
    base = active((SOURCE / 'base-routing.list').read_text())
    wechat_domains = []
    wechat_ua = []
    protected_hosts = []
    # No Tencent-wide ASN bypass: it would route unrelated cloud customers direct.
    for line in active((SOURCE / 'wechat-upstream.list').read_text()):
        kind, value, _ = [s.strip() for s in line.split(',')]
        kind = kind.lower()
        if kind == 'ip-asn':
            continue
        rule = f'{kind}, {value}, direct'
        if kind == 'user-agent':
            wechat_ua.append(rule)
        else:
            wechat_domains.append(rule)
        if kind in {'host', 'host-suffix'}:
            protected_hosts.append(value)
            if kind == 'host-suffix':
                protected_hosts.append('*.' + value)
    ads = active((ROOT / 'rules/Gauss-Ads-QX.list').read_text())
    # Hoist Apple ad endpoints ahead of `host-suffix, apple.com, direct` so they are
    # actually rejected while preserving core Apple services and WeatherKit.
    apple_ads = []
    other_ads = []
    for line in ads:
        kind, value, policy, *_ = [s.strip() for s in line.split(',')]
        if policy == 'reject' and kind in {'host', 'host-suffix'} and is_subdomain_of(value, APPLE_DIRECT_SUFFIXES):
            apple_ads.append(line)
        else:
            other_ads.append(line)
    # Core Apple/weather routes and tested US AI exceptions precede generic ads and WeChat UA.
    protected = [s for s in base if (s.startswith('host') and s.endswith(', US')) or s in {
        'host-suffix, apple.com, direct', 'host-suffix, apple.com.cn, direct',
        'host-suffix, cdn-apple.com, direct'}]
    mt_transport = active((SOURCE / 'meituan-transport.list').read_text())
    # Cainiao cold launch: avoid the conflicting legacy DIRECT suffix in QX.
    cainiao_ads = ['host, s.1rtb.net, reject',
                   'host, api-access.pangolin-sdk-toutiao.com, reject']
    base = [s for s in base if s != 'host-suffix, pangolin-sdk-toutiao.com, direct']
    raw_ordered = wechat_domains + apple_ads + protected + mt_transport + cainiao_ads + other_ads + wechat_ua + base
    ordered = optimize_filters(raw_ordered)
    validate_filters(ordered)
    assert ordered[-2:] == ['geoip, CN, direct', 'final, US']
    # Match the online fallback even if an older local profile ends in HK.
    ordered[-1:-1] = ['ip-cidr, 0.0.0.0/0, US', 'ip6-cidr, ::/0, US']
    routing = '\n'.join([
        '# Gauss QX online routing. Proxy policy: US (DMIT).',
        '# inserted-resource=true; parser OFF; do not force one policy.',
        '# Order: WeChat domains/IPs, Apple ads, AI/Apple, ads, WeChat UA, retained routing, fallback.',
        '# WeChat source: blackmatrix7/ios_rule_script (see components/qx-online).',
        *ordered, ''])
    # A negative *.weixin.qq.com would also exclude the article host. Other
    # WeChat hosts are never added as positives by the module loop below.
    hosts = ['-' + h for h in dict.fromkeys(protected_hosts) if h != '*.weixin.qq.com']
    hosts.extend(['-*short.weixin.qq.com', '-*long.weixin.qq.com',
                  '-*filehelper.weixin.qq.com', 'mp.weixin.qq.com'])
    rewrites = []
    for name in ['Gauss-Apps-QX.snippet', 'Gauss-Video-Ads-QX.snippet', 'Gauss-Meituan-Mine-QX.snippet',
                 'Gauss-YouTube-Enhance-QX.snippet', 'Gauss-Reviewed-Apps-QX.snippet',
                 'Gauss-Cainiao-QX.snippet']:
        for line in active((ROOT / 'modules' / name).read_text()):
            if line.startswith('hostname = '):
                hosts.extend(h.strip() for h in line.split('=', 1)[1].split(',')
                             if h.strip() not in QX_DROPPED_MITM_HOSTS
                             and not any(fnmatch.fnmatchcase(h.strip(), p) for p in protected_hosts))
            elif r'mp\.weixin\.qq\.com' not in line and line not in QX_DROPPED_REWRITES:
                rewrites.append(QX_REWRITE_REPLACEMENTS.get(line, line))
    # Skip the old multi-path article rule above: only the ad response is in scope.
    rewrites.append(r"""^https:\/\/mp\.weixin\.qq\.com\/mp\/getappmsgad\/?(?:\?|$) url jsonjq-response-body 'if type == "object" then (if (.advertisement_info | type) == "array" then .advertisement_info=[] else . end) | (if has("advertisement_num") then .advertisement_num=0 else . end) else . end'""")
    rewrites = list(dict.fromkeys(rewrites))
    # Remove redundant positive MITM hosts already covered by a positive wildcard (e.g. *.cainiao.com).
    dedup_hosts = list(dict.fromkeys(hosts))
    pos_wildcards = [h for h in dedup_hosts if not h.startswith('-') and '*' in h]
    cleaned_hosts = [
        h for h in dedup_hosts
        if h.startswith('-') or '*' in h or not any(fnmatch.fnmatchcase(h, w) for w in pos_wildcards)
    ]
    rewrite = '\n'.join([
        '# Gauss QX online rewrites v2. Parser OFF; replaces old Apps/YouTube resources.',
        '# WeChat: only mp.weixin.qq.com is inspected, for the article ad endpoint.',
        '# YouTube: pinned local API enhancements and UMP beta2; device outcome unverified.',
        'hostname = ' + ', '.join(cleaned_hosts), *rewrites, ''])
    entries = '\n'.join([
        '# Replace the corresponding remote-resource sections; keep local nodes, policies and CA.',
        '[filter_remote]',
        BASE_URL + 'rules/Gauss-Routing-QX.list, tag=Gauss-Routing, inserted-resource=true, opt-parser=false, update-interval=3600, enabled=true',
        '', '[rewrite_remote]',
        BASE_URL + 'modules/Gauss-All-QX.snippet, tag=Gauss-Rewrite, opt-parser=false, update-interval=3600, enabled=true',
        ''])
    return routing, rewrite, entries, {
        'routing_rules': len(ordered), 'routing_pruned': len(raw_ordered) - (len(ordered) - 2),
        'wechat_rules': len(wechat_domains) + len(wechat_ua),
        'apple_ad_rules': len(apple_ads),
        'rewrites': len(rewrites), 'mitm_hosts': len(cleaned_hosts),
        'phone_verified': False, 'youtube_countdown_resolved': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture-routing', type=Path)
    args = parser.parse_args()
    if args.capture_routing:
        capture_routing(args.capture_routing)
    routing, rewrite, entries, report = render()
    for name, content in [('rules/Gauss-Routing-QX.list', routing),
                          ('modules/Gauss-All-QX.snippet', rewrite),
                          ('configs/QuantumultX-online-resources.conf', entries)]:
        (ROOT / name).write_text(content)
    print(json.dumps(report))
