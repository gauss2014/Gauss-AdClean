import fnmatch
import ipaddress
import json
import re
import subprocess
import unittest

from build_qx_online import CAINIAO_LEGACY, ROOT, SOURCE, active, render, validate_filters


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
        self.assertTrue(set(active((SOURCE / 'base-routing.list').read_text())) <= set(self.rules))

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
                if not row.startswith('hostname = ') and r'mp\.weixin\.qq\.com' not in row and row not in CAINIAO_LEGACY:
                    self.assertIn(row, rows)
        for row in rows:
            re.compile(row.split(' ', 1)[0])
        self.assertIn('qx-ump-v0.2.0-beta2', self.rewrite)

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
        rows = [line.split(' url ',1) for line in active(self.rewrite) if ' url ' in line]
        def actions(path, host='cn-acs.m.cainiao.com'):
            return [a for pat,a in rows if re.search(pat,'https://'+host+'/gw/mtop.'+path+'/1.0/')]
        def transform(path,payload):
            action, = actions('cainiao.'+path)
            return json.loads(subprocess.check_output(['jq','-c',action.split("'",1)[1][:-1]],
                              input=json.dumps(payload).encode()))
        keep = [None,42,{'type':'parcel'}]
        noisy = keep+[{'type':'big_banner_area_v870'}, {'type':'todo_list_v860'}]
        def page(xs):
            return {'data':{'result':{'dataList':xs}}}
        self.assertEqual(transform('nbpresentation.protocol.homepage.get.cn',page(noisy)), page(keep))
        key = 'mtop.cainiao.nbpresentation.protocol.homepage.get.cn@3'
        self.assertEqual(transform('nbpresentation.homepage.merge.get.cn',
                         {'data':{key:page(noisy),'parcel':page(noisy)}}),
                         {'data':{key:page(keep),'parcel':page(noisy)}})
        self.assertEqual(transform('adkeyword.get',{'data':{'result':{'keyword':'k','adHotKeywords':['ad']}}}),
                         {'data':{'result':{'keyword':'k','adHotKeywords':[]}}})
        fields = {'vip':3,'parcel':{'id':'sample'}}
        self.assertEqual(transform('app.e2e.engine.page.fetch',{'data':{'data':dict(fields,banner=4,activity=5,asset=1,wallet=2)}}),
                         {'data':{'data':fields}})
        self.assertFalse(actions('cainiao.guoguo.nbnetflow.ads.foo_home'))
        for h in ['guide-acs.m.taobao.com','acs4miniapp-inner.m.taobao.com']:
            self.assertEqual(actions('cainiao.adx.flyad.getad',h), ['reject-dict'])
            self.assertFalse(actions('cainiao.nbmensa.research.researchservice.consultmerge',h))
        self.assertFalse(actions('cainiao.adkeyword.get','oauth.secure.pixiv.net'))

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
