#!/usr/bin/env python3
"""Build two credential-free QX resources from the retained routing snapshot."""
import argparse
import fnmatch
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'components/qx-online'
BASE_URL = 'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/'
CAINIAO_LEGACY = {
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.adkeyword\.get url reject-dict',
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
    r'^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.nbpresentation\.(homepage\.merge|tabbar\.marketing)\.get url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.cainiao\.adx\.flyad\.getad url reject-dict',
    r'^https?:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
    r'^https?:\/\/netflow-mtop\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads url reject-dict',
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


def render():
    base = active((SOURCE / 'base-routing.list').read_text())
    wechat = []
    protected_hosts = []
    # No Tencent-wide ASN bypass: it would route unrelated cloud customers direct.
    for line in active((SOURCE / 'wechat-upstream.list').read_text()):
        kind, value, _ = [s.strip() for s in line.split(',')]
        kind = kind.lower()
        if kind == 'ip-asn':
            continue
        wechat.append(f'{kind}, {value}, direct')
        if kind in {'host', 'host-suffix'}:
            protected_hosts.append(value)
            if kind == 'host-suffix':
                protected_hosts.append('*.' + value)
    # Core Apple/weather routes and tested US AI exceptions precede generic ads.
    protected = [s for s in base if (s.startswith('host') and s.endswith(', US')) or s in {
        'host-suffix, apple.com, direct', 'host-suffix, apple.com.cn, direct',
        'host-suffix, cdn-apple.com, direct'}]
    ads = active((ROOT / 'rules/Gauss-Ads-QX.list').read_text())
    mt_transport = active((SOURCE / 'meituan-transport.list').read_text())
    ordered = list(dict.fromkeys(wechat + protected + mt_transport + ads + base))
    validate_filters(ordered)
    assert ordered[-2:] == ['geoip, CN, direct', 'final, US']
    # Match the online fallback even if an older local profile ends in HK.
    ordered[-1:-1] = ['ip-cidr, 0.0.0.0/0, US', 'ip6-cidr, ::/0, US']
    routing = '\n'.join([
        '# Gauss QX online routing. Proxy policy: US (DMIT).',
        '# inserted-resource=true; parser OFF; do not force one policy.',
        '# Order: WeChat compatibility, AI/Apple, ads, retained routing, fallback.',
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
                             if not any(fnmatch.fnmatchcase(h.strip(), p) for p in protected_hosts))
            elif r'mp\.weixin\.qq\.com' not in line and line not in CAINIAO_LEGACY:
                rewrites.append(line)
    # Skip the old multi-path article rule above: only the ad response is in scope.
    rewrites.append(r"""^https:\/\/mp\.weixin\.qq\.com\/mp\/getappmsgad\/?(?:\?|$) url jsonjq-response-body 'if type == "object" then (if (.advertisement_info | type) == "array" then .advertisement_info=[] else . end) | (if has("advertisement_num") then .advertisement_num=0 else . end) else . end'""")
    rewrites = list(dict.fromkeys(rewrites))
    rewrite = '\n'.join([
        '# Gauss QX online rewrites v1. Parser OFF; replaces old Apps/YouTube resources.',
        '# WeChat: only mp.weixin.qq.com is inspected, for the article ad endpoint.',
        '# YouTube: pinned local API enhancements and UMP beta2; device outcome unverified.',
        'hostname = ' + ', '.join(dict.fromkeys(hosts)), *rewrites, ''])
    entries = '\n'.join([
        '# Replace the corresponding remote-resource sections; keep local nodes, policies and CA.',
        '[filter_remote]',
        BASE_URL + 'rules/Gauss-Routing-QX.list, tag=Gauss-Routing, inserted-resource=true, opt-parser=false, update-interval=3600, enabled=true',
        '', '[rewrite_remote]',
        BASE_URL + 'modules/Gauss-All-QX.snippet, tag=Gauss-Rewrite, opt-parser=false, update-interval=3600, enabled=true',
        ''])
    return routing, rewrite, entries, {
        'routing_rules': len(ordered), 'wechat_rules': len(wechat),
        'rewrites': len(rewrites), 'phone_verified': False,
        'youtube_countdown_resolved': False,
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
