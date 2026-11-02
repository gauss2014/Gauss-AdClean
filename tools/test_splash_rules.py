#!/usr/bin/env python3
"""Exercise existing ad endpoints without assuming a phone-side reproduction."""
import re
import unittest
from fnmatch import fnmatchcase
from urllib.parse import urlsplit

from build_module import render


def rewrite_patterns():
    section = None
    patterns = []
    for line in render().splitlines():
        if line.startswith("["):
            section = line
        elif section == "[URL Rewrite]" and line.startswith("^"):
            patterns.append(re.compile(line.split(" - ", 1)[0]))
    return patterns


class SplashRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patterns = rewrite_patterns()
        host_line = next(line for line in render().splitlines() if line.startswith("hostname = "))
        cls.mitm_hosts = host_line.split("%APPEND%", 1)[1].strip().split(",")
        script_line = next(line for line in render().splitlines()
                           if line.startswith("gauss-xianyu-splash = "))
        cls.splash_script = re.compile(script_line.split("pattern=", 1)[1]
                                      .split(",requires-body=", 1)[0])

    def blocked(self, url):
        return any(pattern.search(url) for pattern in self.patterns)

    def assert_blocked(self, url):
        self.assertTrue(self.blocked(url), url)
        self.assertTrue(any(fnmatchcase(urlsplit(url).hostname, host) for host in self.mitm_hosts), url)

    def assert_filtered(self, url):
        self.assertTrue(self.blocked(url) or self.splash_script.search(url), url)
        self.assertTrue(any(fnmatchcase(urlsplit(url).hostname, host) for host in self.mitm_hosts), url)

    def test_known_splash_endpoints(self):
        urls = [
            "https://api.m.jd.com/api?functionId=delivery_show",
            "https://api.m.jd.com/api?client=apple&functionId=delivery_show&v=1",
            "https://api.m.jd.com/client.action?functionId=home_launchConfig",
            "https://api.m.jd.com/client.action?client=apple&functionId=home_launchConfig&v=1",
            "https://www.meituan.com/api/v7/openscreen?adid=1",
            "https://www.meituan.com/api/v7/openscreen?client=ios&ad=1",
            "https://www.meituan.com/api/v7/appstatus?adid=1",
            "https://www.meituan.com/api/v7/appstatus?client=ios&adId=1",
            "https://wmapi.meituan.com/api/v7/startpicture?client=ios",
            "https://www.meituan.com/api/v7/appstatus?client=ios",
            "https://www.meituan.com/api/v7/appstatus?address=1",
            "https://www.meituan.com/api/v7/appstatus?foo=adid",
            "https://guide-acs.m.taobao.com/gw/mtop.taobao.wireless.home.splash.awesome.get/1.0/?v=1",
            "https://acs.m.taobao.com/gw/mtop.alibaba.aicloud.splash/1.0/?v=1",
            "https://acs.m.goofish.com/gw/mtop.taobao.idle.splash.ads/1.0/?v=1",
            "https://g-acs.m.goofish.com/gw/mtop.taobao.idle.splash.ads/1.0/?v=1",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assert_filtered(url)

    def test_aggressive_mtop_coverage(self):
        targets = {
            "goofish": ["mtop.taobao.idlecommerce.splash", "mtop.taobao.idle.splash.ads",
                        "mtop.taobao.idle.item.recommend.list", "mtop.taobao.idle.user.strategy.list",
                        "mtop.taobao.idlemtopsearch.search.shade", "mtop.taobao.idle.popup.get"],
            "taobao": ["mtop.taobao.wireless.home.splash.awesome.get", "mtop.alibaba.aicloud.splash",
                       "mtop.alibaba.advertisementservice.getadv", "mtop.fc.resource.tacdata.get",
                       "mtop.taobao.volvo.secondfloor.getconfig", "mtop.taobao.marketing.popup"],
        }
        for app, endpoints in targets.items():
            gateways = ["acs", "g-acs", "guide-acs"] + (["h5api"] if app == "taobao" else [])
            for gateway in gateways:
                for path in ("gw", "h5"):
                    for endpoint in endpoints:
                        for suffix in ("/1.0/?client=ios", "?v=1", ""):
                            url = f"https://{gateway}.m.{app}.com/{path}/{endpoint}{suffix}"
                            with self.subTest(url=url):
                                self.assert_filtered(url)

    def test_xianyu_script_is_not_shadowed_by_reject(self):
        for host in ("acs", "g-acs", "guide-acs", "gw", "h5api"):
            for domain in ("goofish", "taobao"):
                for path in ("gw", "h5"):
                    for api in ("idlecommerce.splash.ads",
                                "idlecommerce.splash.async.ads", "idle.splash.ads"):
                        url = f"https://{host}.m.{domain}.com/{path}/mtop.taobao.{api}/2.0/?v=2"
                        with self.subTest(url=url):
                            self.assertTrue(self.splash_script.search(url))
                            self.assertFalse(self.blocked(url), url)
                            self.assert_filtered(url)

    def test_xianyu_restore_and_report(self):
        for host in ("acs", "g-acs", "guide-acs", "gw", "h5api"):
            for domain in ("goofish", "taobao"):
                for api in ("idleadv.scene.restore", "idleadv.app.launch.report", "ad.expose"):
                    url = f"https://{host}.m.{domain}.com/gw/mtop.idle.{api}/1.0/"
                    with self.subTest(url=url):
                        self.assert_blocked(url)

    def test_xianyu_shared_gateways_keep_business_paths(self):
        for host in ("acs", "g-acs", "guide-acs", "gw", "h5api"):
            for domain in ("goofish", "taobao"):
                for api in ("taobao.idle.trade.order", "taobao.idle.address.list",
                            "taobao.idlemtopsearch.search", "taobao.idle.item.detail",
                            "taobao.idle.message.list", "user.login", "trade.pay",
                            "idle.idleadv.scene.restoreOther"):
                    url = f"https://{host}.m.{domain}.com/gw/mtop.{api}/1.0/"
                    with self.subTest(url=url):
                        self.assertFalse(self.blocked(url))
                        self.assertFalse(self.splash_script.search(url))
        self.assertFalse(self.splash_script.search(
            "https://acs.m.goofish.com.evil.invalid/gw/mtop.taobao.idlecommerce.splash.ads/2.0/"))

    def test_jd_function_order_and_both_paths(self):
        for path in ("api", "client.action"):
            for function in ("delivery_show", "home_launchConfig", "lite_advertising", "homeAreaPop",
                             "queryPagePopWindow", "secondFloor", "queryMaterialAdverts"):
                for query in (f"functionId={function}", f"client=apple&functionId={function}&v=1"):
                    with self.subTest(path=path, query=query):
                        self.assert_blocked(f"https://api.m.jd.com/{path}?{query}")

    def test_jd_startup_dispatch_has_one_handler_and_no_early_reject(self):
        script_lines = [line for line in render().splitlines()
                        if " = type=http-response,pattern=" in line]
        patterns = [re.compile(line.split("pattern=", 1)[1].split(",requires-body=", 1)[0])
                    for line in script_lines]
        for path in ("client.action", "api"):
            for suffix in ("", "?", "?functionId=start", "?functionId=startup",
                           "?client=apple&functionId=start&v=1", "?client=apple"):
                url = f"https://api.m.jd.com/{path}{suffix}"
                with self.subTest(url=url):
                    self.assertEqual(sum(bool(p.search(url)) for p in patterns), 1)
                    self.assertFalse(self.blocked(url))
                    self.assertTrue(any(fnmatchcase(urlsplit(url).hostname, host)
                                        for host in self.mitm_hosts))
        main = next(line for line in script_lines if line.startswith("JD_Cleanup_Main = "))
        self.assertIn("/v0.4.2/scripts/jd-response-cleanup.js", main)
        wallet = next(line for line in script_lines if line.startswith("JD_Cleanup_Wallet = "))
        self.assertIn("/v0.3.4/scripts/jd-response-cleanup.js", wallet)

    def test_aggressive_assets(self):
        urls = [
            "https://ossgw.alicdn.com/creatives-assets/prod/splash.avif",
            "https://cloud.video.taobao.com/vod/launch.mp4?download=1",
            "https://cloud.video.taobao.com/play/u/null/sample.mp4",
            "https://img.alicdn.com/imgextra/i1/example-at-ad.jpg?quality=100",
            "https://gw.alicdn.com/imgextra/i2/example-at-ad.avif",
            "https://heic.alicdn.com/imgextra/i2/example-at-ad.heic",
            "https://img10.360buyimg.com/pop/jfs/promotion.avif",
            "https://kjimg10.360buyimg.com/mcmktresadmin/jfs/splash.heic",
            "https://s3plus.meituan.net/v1/mss/linglong/startup.mp4",
            "https://flowplus.meituan.net/v2/mss/brandcpt-vedio/startup.mp4",
        ]
        for host in ("img", "p0", "p12"):
            for directory in ("bizad", "brandCpt", "adunion", "display", "midas", "wmbanner", "mmc"):
                urls.append(f"https://{host}.meituan.net/{directory}/launch.avif?quality=100")
        for url in urls:
            with self.subTest(url=url):
                self.assert_blocked(url)

    def test_meituan_startup_without_ad_query(self):
        for host in ("www", "wmapi"):
            for endpoint in ("openscreen", "appstatus", "loadInfo", "startpicture"):
                for tail in ("", "/", "?client=ios", "/?v=1"):
                    with self.subTest(host=host, endpoint=endpoint, tail=tail):
                        self.assert_blocked(f"https://{host}.meituan.com/api/v12/{endpoint}{tail}")

    def test_unrelated_requests_are_not_blocked(self):
        urls = [
            "https://api.m.jd.com/api?functionId=login",
            "https://api.m.jd.com/api?client=apple&functionId=submitOrder",
            "https://api.m.jd.com/api?functionId=delivery_show_other",
            "https://api.m.jd.com/api?redirect=functionId=delivery_show",
            "https://api.m.jd.com/client.action?functionId=home_launchConfigDetail",
            "https://www.meituan.com/api/v7/orders?adid=1",
            "https://www.meituan.com/api/v7/appstatusOther?adid=1",
            "https://img.meituan.net/product/item.jpg",
            "https://img10.360buyimg.com/n1/jfs/item.jpg",
            "https://img.alicdn.com/imgextra/i1/item.jpg",
            "https://acs.m.taobao.com/gw/mtop.trade.order.query/1.0/",
            "https://g-acs.m.goofish.com/gw/mtop.taobao.idle.trade.order/1.0/",
            "https://g-acs.m.goofish.com/gw/mtop.taobao.idle.address.list/1.0/",
            "https://acs.m.goofish.com.evil.invalid/gw/mtop.taobao.idlecommerce.splash/1.0/",
            "https://ipay.jd.com/pay",
            "https://sso.jd.com/login",
            "https://www.google.com/search?q=test",
            "https://github.com/Gauss2014/Gauss-AdClean",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertFalse(self.blocked(url))

    def test_no_global_routing_change(self):
        sections = re.findall(r"^\[([^]]+)\]$", render(), flags=re.M)
        self.assertEqual(sections, ["Rule", "URL Rewrite", "Body Rewrite", "Script", "MITM"])
        self.assertNotIn("hostname = %APPEND% *\n", render())


if __name__ == "__main__":
    unittest.main()
