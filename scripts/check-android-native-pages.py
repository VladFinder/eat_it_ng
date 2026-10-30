"""Reject Android bundles/APKs with 64-bit libraries that cannot load on 16 KB pages."""

import re
import struct
import sys
import zipfile
from pathlib import Path

PAGE_SIZE = 16 * 1024


def check(path):
    failures = []
    count = 0
    with zipfile.ZipFile(path) as archive, path.open('rb') as raw:
        for entry in archive.infolist():
            if not re.fullmatch(r'(?:base/)?lib/(?:arm64-v8a|x86_64)/[^/]+\.so', entry.filename):
                continue
            count += 1
            data = archive.read(entry)
            if data[:6] != b'\x7fELF\x02\x01':
                failures.append(f'{entry.filename}: expected a little-endian ELF64 library')
                continue
            offset = struct.unpack_from('<Q', data, 32)[0]
            size, entries = struct.unpack_from('<HH', data, 54)
            loads = 0
            for i in range(entries):
                header = offset + i * size
                if struct.unpack_from('<I', data, header)[0] != 1:
                    continue
                loads += 1
                file_offset, address = struct.unpack_from('<QQ', data, header + 8)
                alignment = struct.unpack_from('<Q', data, header + 48)[0]
                if alignment < PAGE_SIZE or (address - file_offset) % PAGE_SIZE:
                    failures.append(f'{entry.filename}: LOAD segment alignment is {alignment}, expected at least 16384')
            if not loads:
                failures.append(f'{entry.filename}: no LOAD segments')
            # Stored libraries load directly from an APK and also require ZIP alignment.
            # AAB ZIP offsets are not APK offsets, so only check APK entries here.
            if path.suffix == '.apk' and entry.compress_type == zipfile.ZIP_STORED:
                raw.seek(entry.header_offset)
                header = raw.read(30)
                name_size, extra_size = struct.unpack_from('<HH', header, 26)
                data_offset = entry.header_offset + 30 + name_size + extra_size
                if data_offset % PAGE_SIZE:
                    failures.append(f'{entry.filename}: APK ZIP entry is not 16 KB aligned')
    if failures:
        raise SystemExit('\n'.join(dict.fromkeys(failures)))
    print(f'16 KB native page validation passed for {count} libraries in {path.name}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/check-android-native-pages.py APP.aab|APP.apk')
    check(Path(sys.argv[1]))
