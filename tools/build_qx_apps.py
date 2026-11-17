#!/usr/bin/env python3
"""Translate the existing approved non-YouTube components to native QX resources."""
import json
import re
from collections import OrderedDict
from pathlib import Path

from build_module import ROOT, COMPONENTS, parse_component


def active(lines):
    return [s.strip() for s in lines if s.strip() and not s.lstrip().startswith('#')]


def render():
    components = [p for p in COMPONENTS if p.name != 'Gauss-YouTube-Local.sgmodule']
    sections = {}
    for path in components:
        for name, lines in parse_component(path).items():
            sections.setdefault(name, []).extend(active(lines))
    filters, rewrites, hosts = [], [], []
    types = {'DOMAIN': 'host', 'DOMAIN-SUFFIX': 'host-suffix', 'IP-CIDR': 'ip-cidr'}
    quic = []
    pdd_count = 0
    base_ads = active((ROOT / 'rules/host-ads.list').read_text().splitlines())
    for line in base_ads + sections['Rule']:
        if line.startswith('AND,'):
            udp = re.fullmatch(r'AND,\(\(DOMAIN,([^,]+)\),\(PROTOCOL,UDP\),\(DST-PORT,443\)\),REJECT', line)
            if udp:
                quic.append(udp[1])
                continue
            pdd = re.fullmatch(r'AND, \(\(URL-REGEX,"(.+)"\),\(USER-AGENT,"\*com\.xunmeng\.pinduoduo\*"\)\), REJECT', line)
            if not pdd:
                raise ValueError('Unsupported compound rule: ' + line)
            rewrites.append(pdd[1] + r' \r\n[Uu]ser-[Aa]gent:[^\r\n]*com\.xunmeng\.pinduoduo[^\r\n]* url-and-header reject')
            pdd_count += 1
        elif line.startswith('URL-REGEX,'):
            rewrites.append(line.split(',', 1)[1] + ' url reject')
            hosts.extend(['speed.coe.ad.*.prod.hosts.ooklaserver.net', 'speed.open.ad.*.prod.hosts.ooklaserver.net'])
        else:
            fields = [x.strip() for x in line.split(',')]
            assert len(fields) in (2, 3, 4) and (len(fields) == 2 or fields[2] == 'REJECT')
            if len(fields) == 4:
                assert fields[3] == 'no-resolve'
            filters.append(f'{types[fields[0]]}, {fields[1]}, reject' + (', no-resolve' if len(fields) == 4 else ''))
    for line in sections['URL Rewrite']:
        pattern, replacement, action = line.split()
        assert replacement == '-' and action in {'reject', 'reject-img', 'reject-200', 'reject-dict', 'reject-array'}
        rewrites.append(f'{pattern} url {action}')
    jq_groups = OrderedDict()
    regex_count = 0
    for line in sections['Body Rewrite']:
        match = re.fullmatch(r"http-response-jq (\S+) '(.*)'", line)
        if match:
            jq_groups.setdefault(match[1], []).append(match[2])
        else:
            kind, pattern, find, replacement = line.split(' ', 3)
            assert kind == 'http-response'
            rewrites.append(f'{pattern} url response-body {find} response-body {replacement}')
            regex_count += 1
    for pattern, expressions in jq_groups.items():
        combined = ' | '.join('(' + e + ')' for e in expressions)
        rewrites.append(f"{pattern} url jsonjq-response-body '{combined}'")
    scripts = []
    for line in sections['Script']:
        pattern = line.split('pattern=', 1)[1].split(',requires-body=', 1)[0]
        script_url = line.split('script-path=', 1)[1].split(',', 1)[0]
        assert script_url.startswith('https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/v0.')
        rewrites.append(f'{pattern} url script-response-body {script_url}')
        scripts.append(script_url)
    for line in sections['MITM']:
        if line.startswith('hostname = '):
            hosts.extend(line.split('=', 1)[1].replace('%APPEND%', '').strip().split(','))
    hosts = list(dict.fromkeys(h.strip() for h in hosts))
    assert set(quic) <= set(hosts)
    filters = list(dict.fromkeys(filters))
    rewrites = list(dict.fromkeys(rewrites))
    snippet = '\n'.join([
        '# Gauss Apps QX 0.1.0; existing approved rules excluding YouTube.',
        '# Native rewrite resource; parser OFF. Keep the separate YouTube resource.',
        '# QX MitM handles QUIC for the listed hosts; no global UDP block.',
        'hostname = ' + ', '.join(hosts), *rewrites, ''])
    filter_text = '\n'.join([
        '# Gauss Ads QX 0.1.0; existing host ads snapshot plus original module filters.',
        '# Add as filter resource with inserted-resource=true so local CN rules do not bypass ads.',
        *filters, ''])
    coverage = {
        'version': 'apps-qx-v0.1.0',
        'components': [p.name for p in components],
        'filter_rules': len(filters), 'rewrite_rules': len(rewrites), 'mitm_hosts': len(hosts),
        'url_rejects': len(sections['URL Rewrite']), 'pdd_url_and_header_rules': pdd_count,
        'jq_source_operations': sum(map(len, jq_groups.values())), 'jq_combined_rules': len(jq_groups),
        'regex_body_rules': regex_count, 'scripts': scripts, 'quic_hosts_handled_by_qx_mitm': quic,
        'youtube_resource_unchanged': True,
    }
    return snippet, filter_text, coverage


if __name__ == '__main__':
    snippet, filters, coverage = render()
    (ROOT / 'modules/Gauss-Apps-QX.snippet').write_text(snippet)
    (ROOT / 'rules/Gauss-Ads-QX.list').write_text(filters)
    (ROOT / 'configs/QuantumultX-apps-coverage.json').write_text(json.dumps(coverage, indent=2) + '\n')
    print(json.dumps(coverage))
