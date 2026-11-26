import fnmatch
import ipaddress
import json
import re
import subprocess
import unittest

from build_qx_online import (
    CAINIAO_LEGACY, QX_DROPPED_REWRITES, QX_REWRITE_REPLACEMENTS,
    ROOT, SOURCE, active, render, validate_filters,
)


class OnlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.routing, cls.rewrite, cls.entries, cls.report = render()
        cls.rules = active(cls.routing)

    def policy(self, host='', ip='', ua='', country=''):
        for line in self.rules:
            kind, value, *rest = [s.strip() for s in line.split(',')]
            if kind == 'final':
                return value
            match = (
                kind == 'host' and host == value or
                kind == 'host-suffix' and (host == value or host.endswith('.' + value)) or
                kind == 'host-keyword' and value in host or
                kind == 'host-wildcard' and fnmatch.fnmatchcase(host, value) or
                kind == 'user-agent' and fnmatch.fnmatchcase(ua, value) or
                kind == 'geoip' and country.lower() == value.lower())
            if kind in {'ip-cidr', 'ip6-cidr'} and ip:
                match = ipaddress.ip_address(ip) in ipaddress.ip_network(value)
            if match:
                return rest[0]

    def test_native_filter_syntax(self):
        validate_filters(self.rules)
        self.assertEqual(sum(s.startswith('final,') for s in self.rules), 1)
        for line in self.rules:
            kind, value, *_ = [s.strip() for s in line.split(',')]
            if kind in {'ip-cidr', 'ip6-cidr'}:
                ipaddress.ip_network(value)

    def test_original_rules_retained(self):
        retained = active((SOURCE / 'base-routing.list').read_text())
        # Every non-removed original rule must either stay verbatim or be subsumed
        # by an earlier rule in the optimized routing table (never silently dropped).
        rules_set = set(self.rules)
        for line in retained:
            if line == 'host-suffix, pangolin-sdk-toutiao.com, direct':
                self.assertNotIn(line, rules_set)
                continue
            if line in rules_set:
                continue
            kind, value, *_ = [s.strip() for s in line.split(',')]
            if kind in {'host', 'host-suffix'}:
                # Covered by an earlier exact/suffix rule (same or higher-priority policy).
                self.assertIn(self.policy(host=value), {'direct', 'reject', 'US'}, line)
            elif kind in {'ip-cidr', 'ip6-cidr'}:
                net = ipaddress.ip_network(value, strict=False)
                self.assertIn(self.policy(ip=str(net.network_address)), {'direct', 'reject', 'US'}, line)
            else:
                self.fail(f'Unexpectedly dropped base rule: {line}')

    def test_no_shadowed_or_conflicting_filters(self):
        seen_exact = set()
        seen_suffixes = set()
        seen_v4, seen_v6 = [], []
        # Exclude the two post-geoip catch-all fallback CIDRs and final.
        body = [r for r in self.rules if r not in {'ip-cidr, 0.0.0.0/0, US', 'ip6-cidr, ::/0, US'}
                and not r.startswith('final,')]
        for line in body:
            kind, value, *_ = [s.strip() for s in line.split(',')]
            key = (kind, value.lower())
            self.assertNotIn(key, seen_exact, f'Duplicate/conflicting filter: {line}')
            seen_exact.add(key)
            if kind in {'host', 'host-suffix'}:
                labels = value.lower().split('.')
                for i in range(len(labels)):
                    anc = '.'.join(labels[i:])
                    self.assertNotIn(anc, seen_suffixes, f'{line} shadowed by host-suffix {anc}')
                if kind == 'host-suffix':
                    seen_suffixes.add(value.lower())
            elif kind == 'ip-cidr':
                net = ipaddress.IPv4Network(value, strict=False)
                self.assertFalse(any(net.subnet_of(p) for p in seen_v4), f'Shadowed IPv4 CIDR: {line}')
                seen_v4.append(net)
            elif kind == 'ip6-cidr':
                net = ipaddress.IPv6Network(value, strict=False)
                self.assertFalse(any(net.subnet_of(p) for p in seen_v6), f'Shadowed IPv6 CIDR: {line}')
                seen_v6.append(net)

    def test_apple_ads_rejected_while_core_apple_direct(self):
        for host in ['advertising.apple.com', 'api-adservices.apple.com',
                     'iad.apple.com', 'iadsdk.apple.com', 'foo.iad.apple.com']:
            self.assertEqual(self.policy(host=host), 'reject', host)
        for host in ['weather-data.apple.com', 'weatherkit.apple.com',
                     'swscan.apple.com', 'apple.com.cn', 'is1-ssl.mzstatic.com', 'cdn-apple.com']:
            self.assertEqual(self.policy(host=host), 'direct', host)

    def test_wechat_in_app_ai_and_ads(self):
        for host in ['chatgpt.com', 'api.openai.com', 'gemini.google.com', 'accounts.google.com']:
            self.assertEqual(self.policy(host=host, ua='MicroMessenger/8.0'), 'US', host)
            self.assertEqual(self.policy(host=host, ua='WeChat/8.0'), 'US', host)
        self.assertEqual(self.policy(host='ad.qq.com', ua='MicroMessenger/8.0'), 'reject')
        self.assertEqual(self.policy(host='mp.weixin.qq.com', ua='MicroMessenger/8.0'), 'direct')
        self.assertEqual(self.policy(ua='MicroMessenger/8.0'), 'direct')

    def test_cainiao_splash_routing(self):
        for host in ['s.1rtb.net', 'api-access.pangolin-sdk-toutiao.com']:
            self.assertIn(f'host, {host}, reject', self.rules)
            self.assertEqual(self.policy(host=host, country='CN'), 'reject')
        for host in ['amdc.m.taobao.com', 'cn-acs.m.cainiao.com', 'other.1rtb.net']:
            self.assertEqual(self.policy(host=host, country='CN'), 'direct')

    def test_ai_weather_lan_and_fallback(self):
        for host in ['chatgpt.com', 'api.openai.com', 'gemini.google.com',
                     'generativelanguage.googleapis.com', 'accounts.google.com']:
            self.assertEqual(self.policy(host=host), 'US', host)
        for host in ['weather-data.apple.com', 'weatherkit.apple.com']:
            self.assertEqual(self.policy(host=host), 'direct', host)
        self.assertEqual(self.policy(ip='192.168.64.1'), 'direct')
        self.assertEqual(self.policy(host='unlisted.invalid'), 'US')
        self.assertEqual(self.policy(ip='8.8.8.8'), 'US')
        self.assertEqual(self.policy(ip='2001:4860:4860::8888'), 'US')
        self.assertEqual(self.policy(ip='114.114.114.114', country='CN'), 'direct')

    def test_wechat_precedes_ads(self):
        for host in ['szextshort.weixin.qq.com', 'szfilehelper.weixin.qq.com',
                     'wxsnsdythumb.wxs.qq.com', 'res.wx.qq.com', 'wx.qlogo.cn',
                     'mmbiz.qpic.cn', 'sgshort.wechat.com', 'mp.weixin.qq.com',
                     'apd-pcdnwxlogin.teg.tencent-cloud.net']:
            self.assertEqual(self.policy(host=host), 'direct', host)
        self.assertEqual(self.policy(ua='MicroMessenger/8.0'), 'direct')
        self.assertFalse(any(s.startswith('ip-asn,') for s in self.rules))
        self.assertEqual(self.policy(host='ad.qq.com'), 'reject')

    def test_meituan_exact_shark_hosts(self):
        for host in ['shark-mt.meituan.com', 'shark-default.meituan.com']:
            self.assertEqual(self.policy(host=host), 'reject')
        for host in ['shark-dp.meituan.com', 'httpdnsvip.meituan.com', 'mquic-a.meituan.com']:
            self.assertEqual(self.policy(host=host), 'reject')
        for ip in ['202.90.108.13', '2405:1480:3000:303b::303b']:
            self.assertEqual(self.policy(ip=ip), 'reject')
        for host in ['npay.meituan.com', 'mt-personalcenter.meituan.com']:
            self.assertEqual(self.policy(host=host), 'direct')

    def test_wechat_article_only(self):
        hosts = active(self.rewrite)[0].split('=', 1)[1].strip().split(', ')
        self.assertEqual([p for p in hosts if fnmatch.fnmatchcase('mp.weixin.qq.com', p.lstrip('-'))], ['mp.weixin.qq.com'])
        for host in ['szshort.weixin.qq.com', 'szfilehelper.weixin.qq.com', 'mmbiz.qpic.cn', 'wx.tenpay.com']:
            matches = [p for p in hosts if fnmatch.fnmatchcase(host, p.lstrip('-'))]
            self.assertTrue(matches, host)
            self.assertTrue(all(p.startswith('-') for p in matches), matches)
        rules = [r.split(' url ',1) for r in active(self.rewrite) if ' url ' in r]
        def actions(s):
            return [act for rx, act in rules if re.search(rx, 'https://mp.weixin.qq.com/'+s)]
        act, = actions('mp/getappmsgad?biz=x')
        for path in ['s?__biz=x', 'mp/getappmsgad2', 'mp/relatedarticle', 'mp/masonryfeed']:
            self.assertEqual(actions(path), [])
        expr=act.split("'",1)[1][:-1]
        for value, expected in [({'advertisement_info':[1], 'advertisement_num':1, 'keep':2},
                                 {'advertisement_info':[], 'advertisement_num':0, 'keep':2}), ({'err':1},{'err':1})]:
            self.assertEqual(json.loads(subprocess.check_output(['jq',expr],input=json.dumps(value).encode())),expected)

    def test_rewrite_preserves_other_apps_and_yt(self):
        rows = active(self.rewrite)[1:]
        for name in ['Gauss-Apps-QX.snippet', 'Gauss-YouTube-Enhance-QX.snippet']:
            for row in active((ROOT / 'modules' / name).read_text()):
                if not row.startswith('hostname = ') and r'mp\.weixin\.qq\.com' not in row and row not in QX_DROPPED_REWRITES:
                    self.assertIn(QX_REWRITE_REPLACEMENTS.get(row, row), rows)
        for row in rows:
            re.compile(row.split(' ', 1)[0])
        self.assertIn('qx-ump-v0.2.0-beta2', self.rewrite)

    def test_rewrites_optimized_and_unified(self):
        hosts = active(self.rewrite)[0].split('=', 1)[1].strip().split(', ')
        rows = [s.split(' url ', 1) for s in active(self.rewrite) if ' url ' in s]
        def actions(url):
            return [a for rx, a in rows if re.search(rx, url)]
        # Unified script pins: no legacy v0.3.4 or 99d6d85a left.
        self.assertNotIn('/v0.3.4/scripts/jd-response-cleanup.js', self.rewrite)
        self.assertNotIn('99d6d85a85f0705e18337d1c802ec8a2d82ddc4b', self.rewrite)
        # JD main script narrowed to handled functionIds and no-functionId calls.
        for hit in ['https://api.m.jd.com/api?functionId=start',
                    'https://api.m.jd.com/client.action?client=apple&functionId=startup&v=1',
                    'https://api.m.jd.com/client.action?functionId=welcomeHome',
                    'https://api.m.jd.com/api?functionId=personinfoBusiness&x=1',
                    'https://api.m.jd.com/api?functionId=getTabHomeInfo',
                    'https://api.m.jd.com/api',
                    'https://api.m.jd.com/client.action?client=apple']:
            matched = actions(hit)
            self.assertEqual(len(matched), 1, hit)
            self.assertIn('/v0.4.2/scripts/jd-response-cleanup.js', matched[0])
        for bypass in ['https://api.m.jd.com/api?functionId=submitOrder',
                       'https://api.m.jd.com/client.action?client=apple&functionId=productDetail&v=1',
                       'https://api.m.jd.com/api?functionId=search&keyword=ssd',
                       'https://api.m.jd.com/api?functionId=cart']:
            self.assertEqual(actions(bypass), [], bypass)
        # Meituan startpicture uses clean reject-dict (single match, no harsh reject).
        self.assertEqual(actions('https://wmapi.meituan.com/api/v7/startpicture?client=ios'), ['reject-dict'])
        # Taobao product videos restored and removed from MITM.
        self.assertNotIn('cloud.video.taobao.com', hosts)
        self.assertEqual(actions('https://cloud.video.taobao.com/vod/product.mp4'), [])
        # Cainiao mshow.cn has single clean match (no duplicate rule).
        self.assertEqual(actions('https://edge.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.mshow.cn'), ['reject-200'])
        # Redundant *.cainiao.com subdomains pruned from MITM hostname list.
        self.assertNotIn('cn-acs.m.cainiao.com', hosts)
        self.assertNotIn('netflow-mtop.cainiao.com', hosts)

    def test_youtube_urls(self):
        rows = [s.split(' url ', 1) for s in active(self.rewrite) if ' url ' in s]
        def actions(url):
            return [action for rx, action in rows if re.search(rx, url)]
        for route in ('browse','next','player','search','reel/reel_watch_sequence','guide','account/get_setting','get_watch'):
            for host in ('youtubei','youtubei-att'):
                matched = actions(f'https://{host}.googleapis.com/youtubei/v1/{route}?x=1')
                self.assertEqual(len(matched), 1)
                self.assertTrue(matched[0].endswith('/scripts/youtube-enhance-qx.js'))
        for path in ('pagead/id','ptracking?x=a','api/stats/ads','api/stats/qoe?x=1&adcontext=x'):
            self.assertEqual(actions('https://s.youtube.com/'+path), ['reject-200'])
        self.assertEqual(actions('https://s.youtube.com/api/stats/qoe?v=1'), [])
        base = 'https://r2.googlevideo.com/'
        self.assertEqual(actions(base+'other?id=1&oad=1'), ['reject-200'])
        self.assertEqual(actions(base+'videoplayback?id=1&oad=1'), [])
        self.assertEqual(actions(base+'dclk_video_ads?id=1&oad=1'), [])
        self.assertEqual(actions(base+'other?download=1'), [])
        url = base+'other?id=x&ctier=L&foo=z&sparams=id,ctier,foo'
        rx, action = next((rx, a) for rx,a in rows if a.startswith('302 ') and re.search(rx,url))
        self.assertEqual(re.sub(rx, re.sub(r'\$(\d)',r'\\g<\1>',action[4:]),url),
                         base+'other?id=x&foo=z&sparams=id,foo')

    def test_cainiao_actual_rules(self):
        rows = [line.split(' url ', 1) for line in active(self.rewrite) if ' url ' in line]
        def actions(url):
            return [a for pat, a in rows if re.search(pat, url)]
        base = 'https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/scripts/'
        self.assertEqual(actions('http://amdc.m.taobao.com/amdc/mobileDispatch?appkey=x'),
                         ['script-response-body '+base+'amdc.js'])
        self.assertIn('*.cainiao.com', active(self.rewrite)[0].split(' = ')[1].split(', '))
        app = 'https://edge.cainiao.com/gw/mtop.cainiao.'
        self.assertEqual(actions(app+'guoguo.nbnetflow.ads.index.cn'), ['reject-200'])
        self.assertEqual(actions(app+'guoguo.nbnetflow.ads.foo_home'), [])
        self.assertEqual(actions(app+'nbpresentation.homepage.merge.get.cn'),
                         ['script-response-body '+base+'cainiao_json.js'])
        for h in ['guide-acs.m.taobao.com','acs4miniapp-inner.m.taobao.com']:
            self.assertEqual(actions('https://'+h+'/gw/mtop.cainiao.nbmensa.research.researchservice.consultmerge'),
                             ['reject-200'])
        run = """const fs=require('fs'),vm=require('vm');
        const [name,ua,url,body]=process.argv.slice(1);
        vm.runInNewContext(fs.readFileSync(name,'utf8'),{$request:{url,headers:{'User-Agent':ua}},
            $response:{body},$done:r=>process.stdout.write(JSON.stringify(r))});"""
        def script(name, ua='', url='', body='{}'):
            return json.loads(subprocess.check_output(['node','-e',run,str(ROOT/'scripts'/name),ua,url,body]))
        for ua in ['Cainiao/1', 'AMap', 'Hema4iPhone']:
            self.assertEqual(script('amdc.js',ua), {'body':'ddgksf2013'})
        self.assertEqual(script('amdc.js','UnrelatedApp'), {})
        out = script('cainiao_json.js',url=app+'app.e2e.engine.page.fetch',
                     body=json.dumps({'data':{'data':{'wallet':1,'vip':2,'parcel':3}}}))
        self.assertEqual(json.loads(out['body']), {'data':{'data':{'parcel':3}}})

    def test_remote_entries_and_no_secrets(self):
        self.assertIn('inserted-resource=true', self.entries)
        self.assertNotIn('force-policy=', self.entries)
        self.assertEqual(self.entries.count('update-interval=3600'), 2)
        for content in [self.routing, self.rewrite, self.entries]:
            for forbidden in ['password=', 'passphrase =', 'p12 =', 'vless=', 'reality-hex-shortid=']:
                self.assertNotIn(forbidden, content)

    def test_bili_search_results(self):
        line, = [x for x in active(self.rewrite) if r'/v2\/search(?:' in x]
        path, expr = line.split(' url jsonjq-response-body ', 1)
        base = 'https://app.bilibili.com/x/v2/search'
        for suffix in ('?keyword=example', '/type?page=2'):
            self.assertRegex(base + suffix, path)
        for suffix in ('/defaultwords', '/suggest', '/square', '/typeahead'):
            self.assertNotRegex(base + suffix, path)
        keep = [{'title': '广告设计教程', 'badge': '视频', 'ad_info': {}},
                {'title': '廣告制作', 'badge_style': {'text': '原创'}}, None]
        ads = [{'badge': '广告'}, {'badge': {'text': '廣告'}},
               {'badge_style': {'text': '广告'}}, {'goto': 'cm'}, {'is_ad': 1},
               {'ad_info': {'creative_id': 123}}]
        def apply(value):
            return json.loads(subprocess.check_output(['jq', '-c', expr[1:-1]],
                              input=json.dumps(value).encode()))
        for key in ('item', 'items'):
            data = {'page': 2, 'trackid': 'test', 'nav': [{'total': 12}]}
            payload = {'code': 0, 'data': dict(data, **{key: keep[:1] + ads + keep[1:]})}
            self.assertEqual(apply(payload), {'code': 0, 'data': dict(data, **{key: keep})})
        for payload in ({'code': -1, 'data': {'item': ads}}, {'code': 0, 'data': {'items': {}}}):
            self.assertEqual(apply(payload), payload)

    def test_generated_files_current(self):
        for name, content in [('rules/Gauss-Routing-QX.list', self.routing),
                              ('modules/Gauss-All-QX.snippet', self.rewrite),
                              ('configs/QuantumultX-online-resources.conf', self.entries)]:
            self.assertEqual((ROOT / name).read_text(), content)


if __name__ == '__main__':
    unittest.main()
