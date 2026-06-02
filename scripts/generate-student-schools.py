#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlparse

try:
    from pypinyin import Style, lazy_pinyin
except ImportError as error:
    raise SystemExit(
        'pypinyin is required for generating static pinyin search data. '
        'Install it outside the app dependency graph, for example: '
        'python3 -m pip install --target /tmp/tgw-pypinyin pypinyin && '
        'PYTHONPATH=/tmp/tgw-pypinyin python3 scripts/generate-student-schools.py'
    ) from error


SOURCE_DIR = Path(os.environ.get('SCHOOL_SOURCE_DIR', '/tmp/tgw-school-sources'))
OUTPUT_FILE = Path(os.environ.get('SCHOOL_OUTPUT', 'src/data/student-schools.ts'))

SOURCE_META = OrderedDict([
    ('privacy', {
        'label': 'Privacy option',
        'url': '',
    }),
    ('hcfpz-api', {
        'label': 'api.hcfpz.cn school list snapshot',
        'url': 'https://api.hcfpz.cn/un/schools',
    }),
    ('cn-universitysrv', {
        'label': 'XanCafe/cn-universitysrv API schema',
        'url': 'https://github.com/XanCafe/cn-universitysrv',
    }),
    ('aurorai-gist', {
        'label': 'Aurorai gist school-data.json',
        'url': 'https://gist.github.com/Aurorai/dfe84b9ed58913e2b9cd',
    }),
    ('edu-website', {
        'label': 'jorhelp/EDU_Website edu.json',
        'url': 'https://github.com/jorhelp/EDU_Website',
    }),
    ('chinese-universities', {
        'label': 'xioajiumi/Chinese_Universities JSON',
        'url': 'https://github.com/xioajiumi/Chinese_Universities',
    }),
    ('domain-names', {
        'label': 'Demired/Domain-names-of-Chinese-universities edu.json',
        'url': 'https://github.com/Demired/Domain-names-of-Chinese-universities',
    }),
])


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def has_cjk(value: str) -> bool:
    return bool(re.search(r'[\u3400-\u9fff]', value))


def clean_name(value: object) -> str:
    if not isinstance(value, str):
        return ''

    return re.sub(r'\s+', '', value.strip())


def clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ''

    return re.sub(r'\s+', ' ', value.strip())


def normalize_search_text(value: str) -> str:
    value = value.lower()
    value = re.sub(r'https?://', '', value)
    return re.sub(r'[\s/\\:_\-()（）【】\[\]{}.,，。·]+', '', value)


def normalize_domain(value: object) -> str:
    text = clean_text(value)
    if not text:
        return ''

    parsed = urlparse(text if re.match(r'^[a-z]+://', text, flags=re.I) else f'https://{text}')
    host = (parsed.hostname or text).lower().strip()
    return host.removeprefix('www.')


def parse_concatenated_json(path: Path) -> list[dict]:
    decoder = json.JSONDecoder()
    text = path.read_text(encoding='utf-8').strip()
    items = []
    index = 0
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            break
        item, offset = decoder.raw_decode(text, index)
        items.append(item)
        index = offset
    return items


def pinyin_tokens(name: str) -> tuple[str, str]:
    syllables = lazy_pinyin(name, style=Style.NORMAL, errors='ignore')
    full = ''.join(syllables)
    initials = ''.join(syllable[0] for syllable in syllables if syllable)
    return full, initials


def school_record(name: str) -> dict:
    return {
        'name': name,
        'province': '',
        'city': '',
        'domains': OrderedDict(),
        'aliases': OrderedDict(),
        'sources': OrderedDict(),
    }


schools: OrderedDict[str, dict] = OrderedDict()
source_counts = {source_id: 0 for source_id in SOURCE_META}


def add_school(
    name: object,
    *,
    source: str,
    province: object = '',
    city: object = '',
    domain: object = '',
    alias: object = '',
) -> None:
    normalized_name = clean_name(name)
    if not normalized_name or not has_cjk(normalized_name):
        return

    record = schools.setdefault(normalized_name, school_record(normalized_name))
    if not record['province']:
        record['province'] = clean_text(province)
    if not record['city']:
        record['city'] = clean_text(city)

    normalized_domain = normalize_domain(domain)
    if normalized_domain:
        record['domains'][normalized_domain] = True

    cleaned_alias = clean_text(alias)
    if cleaned_alias and cleaned_alias != normalized_name:
        record['aliases'][cleaned_alias] = True

    record['sources'][source] = True
    source_counts[source] += 1


def load_hcfpz_api() -> None:
    payload = read_json(SOURCE_DIR / 'hcfpz-schools.json')
    for item in payload.get('data', []):
        add_school(
            item.get('name'),
            source='hcfpz-api',
            province=item.get('province'),
            city=item.get('city'),
        )
        add_school(
            item.get('name'),
            source='cn-universitysrv',
            province=item.get('province'),
            city=item.get('city'),
        )


def load_aurorai_gist() -> None:
    payload = read_json(SOURCE_DIR / 'aurorai-school-data.json')
    for province in payload.get('provs', []):
        for item in province.get('univs', []):
            add_school(item.get('name'), source='aurorai-gist', province=province.get('name'))


def load_edu_website() -> None:
    payload = read_json(SOURCE_DIR / 'EDU_Website/edu.json')
    for province, schools_by_name in payload.items():
        for name, website in schools_by_name.items():
            add_school(name, source='edu-website', province=province, domain=website)


def load_chinese_universities() -> None:
    for item in parse_concatenated_json(SOURCE_DIR / 'Chinese_Universities/Chinese_Universities.json'):
        add_school(
            item.get('name'),
            source='chinese-universities',
            province=item.get('location'),
            domain=item.get('link'),
            alias=item.get('name_eng'),
        )


def load_domain_names() -> None:
    payload = read_json(SOURCE_DIR / 'Domain-names-of-Chinese-universities/edu.json')
    for item in payload:
        add_school(
            item.get('name'),
            source='domain-names',
            province=item.get('tag'),
            domain=item.get('domain'),
        )


def build_search_text(record: dict) -> str:
    full_pinyin, initials = pinyin_tokens(record['name'])
    tokens = OrderedDict()
    for value in [
        record['name'],
        record['province'],
        record['city'],
        full_pinyin,
        initials,
        *record['aliases'].keys(),
        *record['domains'].keys(),
    ]:
        cleaned = clean_text(value)
        if not cleaned:
            continue
        tokens[cleaned.lower()] = True
        normalized = normalize_search_text(cleaned)
        if normalized:
            tokens[normalized] = True
    return ' '.join(tokens.keys())


def render_ts() -> str:
    privacy = {
        'name': '保密',
        'province': '',
        'city': '',
        'domains': OrderedDict(),
        'aliases': OrderedDict([
            ('private', True),
            ('privacy', True),
            ('confidential', True),
        ]),
        'sources': OrderedDict([('privacy', True)]),
    }
    source_counts['privacy'] = 1

    rows = []
    for record in [privacy, *schools.values()]:
        row = {'name': record['name']}
        if record['province']:
            row['province'] = record['province']
        if record['city']:
            row['city'] = record['city']
        domains = list(record['domains'].keys())
        aliases = list(record['aliases'].keys())
        sources = list(record['sources'].keys())
        if domains:
            row['domains'] = domains
        if aliases:
            row['aliases'] = aliases
        row['searchText'] = build_search_text(record)
        row['sources'] = sources
        rows.append(row)

    source_rows = []
    for source_id, meta in SOURCE_META.items():
        source_rows.append({
            'id': source_id,
            'label': meta['label'],
            'url': meta['url'],
            'rawEntries': source_counts[source_id],
        })

    source_json = json.dumps(source_rows, ensure_ascii=False, indent=2)
    school_json = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))

    return '\n'.join([
        '// Generated by scripts/generate-student-schools.py. Do not edit manually.',
        '/* eslint-disable style/quote-props, style/quotes, style/comma-dangle */',
        '',
        'export interface StudentSchoolSuggestion {',
        '  name: string',
        '  province?: string',
        '  city?: string',
        '  domains?: string[]',
        '  aliases?: string[]',
        '  searchText: string',
        '  sources: string[]',
        '}',
        '',
        f'export const STUDENT_SCHOOL_SOURCE_SUMMARY = {source_json} as const',
        '',
        'export const STUDENT_SCHOOL_SUGGESTIONS = JSON.parse(',
        f'  {json.dumps(school_json, ensure_ascii=False)},',
        ') as StudentSchoolSuggestion[]',
        '',
    ])


def main() -> None:
    load_hcfpz_api()
    load_aurorai_gist()
    load_edu_website()
    load_chinese_universities()
    load_domain_names()
    OUTPUT_FILE.write_text(render_ts(), encoding='utf-8')
    print(f'Generated {len(schools) + 1} school suggestions at {OUTPUT_FILE}')
    for source_id, count in source_counts.items():
        print(f'{source_id}: {count}')


if __name__ == '__main__':
    main()
