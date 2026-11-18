import fnmatch
import ipaddress
import re
import unittest

from build_qx_online import ROOT, SOURCE, active, render, validate_filters


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

    def test_wechat_not_decrypted_or_rewritten(self):
        hosts = active(self.rewrite)[0].split('=', 1)[1].strip().split(', ')
        for host in ['mp.weixin.qq.com', 'szshort.weixin.qq.com', 'mmbiz.qpic.cn']:
            matches = [p for p in hosts if fnmatch.fnmatchcase(host, p.lstrip('-'))]
            self.assertTrue(matches, host)
            self.assertTrue(all(p.startswith('-') for p in matches), matches)
        self.assertNotIn(r'mp\.weixin\.qq\.com', self.rewrite)

    def test_rewrite_preserves_other_apps_and_yt(self):
        rows = active(self.rewrite)[1:]
        for name in ['Gauss-Apps-QX.snippet', 'Gauss-YouTube-UMP-QX-TEST.snippet']:
            for row in active((ROOT / 'modules' / name).read_text()):
                if not row.startswith('hostname = ') and r'mp\.weixin\.qq\.com' not in row:
                    self.assertIn(row, rows)
        for row in rows:
            re.compile(row.split(' ', 1)[0])
        self.assertIn('qx-ump-v0.2.0-beta2', self.rewrite)

    def test_remote_entries_and_no_secrets(self):
        self.assertIn('inserted-resource=true', self.entries)
        self.assertNotIn('force-policy=', self.entries)
        self.assertEqual(self.entries.count('update-interval=3600'), 2)
        for content in [self.routing, self.rewrite, self.entries]:
            for forbidden in ['password=', 'passphrase =', 'p12 =', 'vless=', 'reality-hex-shortid=']:
                self.assertNotIn(forbidden, content)

    def test_generated_files_current(self):
        for name, content in [('rules/Gauss-Routing-QX.list', self.routing),
                              ('modules/Gauss-All-QX.snippet', self.rewrite),
                              ('configs/QuantumultX-online-resources.conf', self.entries)]:
            self.assertEqual((ROOT / name).read_text(), content)


if __name__ == '__main__':
    unittest.main()
