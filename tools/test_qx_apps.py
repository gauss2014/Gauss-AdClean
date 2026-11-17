import json
import re
import subprocess
import unittest
from fnmatch import fnmatchcase

from build_qx_apps import ROOT, render


class QXApps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snippet, cls.filters, cls.coverage = render()
        cls.lines = [l for l in cls.snippet.splitlines() if l and not l.startswith('#')]
        cls.hosts = cls.lines[0].split(' = ', 1)[1].split(', ')
        cls.rules = cls.lines[1:]

    def match(self, url):
        return [r for r in self.rules if ' url ' in r and re.search(r.split(' url ')[0], url)]

    def test_generated_files_current(self):
        self.assertEqual((ROOT / 'modules/Gauss-Apps-QX.snippet').read_text(), self.snippet)
        self.assertEqual((ROOT / 'rules/Gauss-Ads-QX.list').read_text(), self.filters)

    def test_native_syntax_all_patterns(self):
        for line in self.rules:
            if ' url-and-header ' in line:
                patterns, action = line.split(' url-and-header ')
                url, header = patterns.split(' ', 1)
                re.compile(url)
                re.compile(header)
                self.assertEqual(action, 'reject')
            else:
                pattern, tail = line.split(' url ', 1)
                re.compile(pattern)
                self.assertIn(tail.split(' ', 1)[0], ['reject', 'reject-200', 'reject-dict',
                    'reject-array', 'reject-img', 'response-body', 'jsonjq-response-body', 'script-response-body'])
        self.assertNotRegex(self.snippet, r'^\[|%APPEND%|ca-p12|ca-passphrase|script-path=|AND,')
        for line in self.filters.splitlines():
            if line.startswith('#'):
                continue
            self.assertRegex(line, r'^(host|host-suffix|ip-cidr), [^, ]+, reject(, no-resolve)?$')

    def test_known_apps_and_business_preservation(self):
        for url in ['https://api.m.jd.com/api?functionId=delivery_show',
                    'https://wmapi.meituan.com/api/v7/startpicture?client=ios',
                    'https://api.zhihu.com/commercial_api/test',
                    'https://mp.weixin.qq.com/mp/getappmsgad',
                    'https://ad.12306.cn/ad/ser/getAdList']:
            self.assertTrue(self.match(url), url)
        for url in ['https://chatgpt.com/backend-api/conversation',
                    'https://gemini.google.com/app', 'https://weather-data.apple.com/v1/weather',
                    'https://acs.m.goofish.com/gw/mtop.taobao.idle.trade.order/1.0/',
                    'https://ipay.jd.com/pay', 'https://api.m.jd.com/api?functionId=submitOrder']:
            self.assertFalse(any(' url reject' in r for r in self.match(url)), url)
        for host in ['chatgpt.com', 'gemini.google.com', 'weather-data.apple.com',
                     'youtubei.googleapis.com', 'rr4.googlevideo.com']:
            self.assertFalse(any(fnmatchcase(host, h) for h in self.hosts), host)

    def test_xianyu_script_not_shadowed(self):
        for gateway in ['acs', 'g-acs', 'guide-acs', 'gw', 'h5api']:
            for domain in ['taobao', 'goofish']:
                url = f'https://{gateway}.m.{domain}.com/gw/mtop.taobao.idlecommerce.splash.ads/1.0/'
                matches = self.match(url)
                self.assertEqual(len(matches), 1, url)
                self.assertIn('script-response-body', matches[0])

    def jq(self, url, data):
        lines = [l for l in self.match(url) if 'jsonjq-response-body' in l]
        self.assertEqual(len(lines), 1)
        expression = lines[0].split(' jsonjq-response-body ', 1)[1][1:-1]
        return json.loads(subprocess.check_output(['jq', '-c', expression], input=json.dumps(data), text=True))

    def test_keep_all_operations_applied_together(self):
        data = {'data': {'splashAdLoadTimeLimit': 2, 'aliHCSpotConfig': [1], 'hotFeedSpotFixedPositionSecond': 5, 'course': 'keep'}}
        self.assertEqual(self.jq('https://api.gotokeep.com/op-engine-webapp/v1/configs', data), {'data': {'course': 'keep'}})

    def test_weibo_multistep_preserves_regular_posts(self):
        data = {'statuses': [{'ad_marked': True}, {'text': 'normal'}], 'ad': 1, 'ad_version_2_weibo': 2, 'advertises': [3]}
        self.assertEqual(self.jq('https://api.weibo.cn/2/statuses/friends/timeline', data), {'statuses': [{'text': 'normal'}]})

    def test_iqiyi_merged_switches(self):
        data = {'content': {'resource': {'cast_device_ad': [1], 'normal': True},
            'switchs': {'app_ad': {'app_ad_enable': 1, 'app_ad_duration': 5},
                       'ios_tech': {'ad_download': 1, 'kPreadAdHintSwitch': 1},
                       'm_qiyi_ios_tech': {'KFocusAdVideoPlayTimesIn4G': 2}}}}
        result = self.jq('https://iface2.iqiyi.com/fusion/3.0/common_switch?v=1', data)
        self.assertEqual(result['content']['resource'], {'normal': True})
        for settings in result['content']['switchs'].values():
            self.assertTrue(all(value == 0 for value in settings.values()))

    def test_every_jq_expression_compiles(self):
        for line in self.rules:
            if ' jsonjq-response-body ' in line:
                expression = line.split(' jsonjq-response-body ', 1)[1][1:-1]
                result = subprocess.run(['jq', '-n', 'if false then (' + expression + ') else null end'], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_pdd_requires_user_agent(self):
        for url in ['http://1.2.3.4/d1', 'http://[2001:db8::1]/d1?x=1']:
            matches = []
            for line in self.rules:
                if ' url-and-header ' in line:
                    patterns = line.split(' url-and-header ')[0]
                    pattern, header = patterns.split(' ', 1)
                    if re.search(pattern, url):
                        matches.append(header)
            self.assertTrue(matches, url)
            self.assertTrue(any(re.search(h, '\r\nUser-Agent: com.xunmeng.pinduoduo/1.0\r\n') for h in matches))
            self.assertFalse(any(re.search(h, '\r\nUser-Agent: Safari\r\n') for h in matches))

    def test_existing_script_versions_unchanged_and_offline(self):
        for url in self.coverage['scripts']:
            tag, script_path = url.split('/Gauss-AdClean/')[1].split('/', 1)
            source = subprocess.check_output(['git', 'show', f'{tag}:{script_path}'], cwd=ROOT, text=True)
            for token in ['$httpClient', '$task', 'fetch(', 'XMLHttpRequest', 'WebSocket', '$persistentStore', '$notification']:
                self.assertNotIn(token, source)
            self.assertIn('$done', source)

    def test_ad_filters_preserve_ai_weather_and_business_domains(self):
        for host in ['chatgpt.com', 'api.openai.com', 'cdn.oaistatic.com', 'files.oaiusercontent.com',
                     'challenges.cloudflare.com', 'gemini.google.com', 'accounts.google.com',
                     'generativelanguage.googleapis.com', 'www.gstatic.com', 'weather-data.apple.com',
                     'weatherkit.apple.com', 'acs.m.goofish.com', 'api.m.jd.com', 'ms.jr.jd.com']:
            matches = []
            for line in self.filters.splitlines():
                if line.startswith('#'):
                    continue
                kind, value, *_ = line.split(', ')
                if (kind == 'host' and value == host) or (kind == 'host-suffix' and (host == value or host.endswith('.' + value))):
                    matches.append(line)
            self.assertEqual(matches, [], host)


if __name__ == '__main__':
    unittest.main()
