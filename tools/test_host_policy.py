"""Check static routing intent; phone runtime selection needs a live check."""
from pathlib import Path
import unittest


class HostPolicy(unittest.TestCase):
    def test_default_and_exceptions(self):
        text = (Path(__file__).resolve().parents[1] / 'configs/Host-HK-AI-US.conf').read_text()
        rules = text.split('[Rule]', 1)[1].split('[Host]', 1)[0].strip().splitlines()
        self.assertEqual(rules[-1], 'FINAL,HK')
        self.assertFalse(any(r.startswith(('IP-CIDR6,::/0,', 'IP-CIDR,0.0.0.0/0,')) for r in rules))
        for domain in ('openai.com', 'claude.ai', 'amazon.com'):
            self.assertIn(f'DOMAIN-SUFFIX,{domain},US', rules)
        for domain in ('apple.com', 'hitminer.cn'):
            self.assertIn(f'DOMAIN-SUFFIX,{domain},DIRECT', rules)
        for cidr in ('fc00::/7', 'fe80::/10', '::1/128'):
            self.assertIn(f'IP-CIDR6,{cidr},DIRECT,no-resolve', rules)


if __name__ == '__main__':
    unittest.main()
