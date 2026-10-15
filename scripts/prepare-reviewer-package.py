"""Prepare a complete, checksum-verified research bundle for approved code access.

Python 3.12 standard library only. Scientific files are read, never modified.
Output is reviewer/{package.json,archive.json,README.md,assemble.py,parts/...}.
The ZIP64 byte stream is split below GitHub's individual-file size limit.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import zipfile

PART_SIZE = 48 * 1024 * 1024
BLOCK_SIZE = 1024 * 1024
ASSEMBLER = r'''"""Verify and extract the approved research package; Python 3 standard library."""
import argparse
import bisect
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import zipfile

BLOCK = 1024 * 1024


class PartsReader(io.RawIOBase):
    def __init__(self, paths):
        super().__init__()
        self.paths = paths
        self.offsets = [0]
        for path in paths:
            self.offsets.append(self.offsets[-1] + path.stat().st_size)
        self.position = 0
        self.current_index = -1
        self.stream = None

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        pos = offset if whence == 0 else self.position + offset if whence == 1 else self.offsets[-1] + offset if whence == 2 else -1
        if pos < 0:
            raise ValueError('Invalid archive seek')
        self.position = pos
        return pos

    def read(self, size=-1):
        remaining = max(0, self.offsets[-1] - self.position)
        if size >= 0:
            remaining = min(remaining, size)
        chunks = []
        while remaining:
            index = bisect.bisect_right(self.offsets, self.position) - 1
            if index != self.current_index:
                if self.stream:
                    self.stream.close()
                self.stream = self.paths[index].open('rb')
                self.current_index = index
            self.stream.seek(self.position - self.offsets[index])
            chunk = self.stream.read(min(remaining, self.offsets[index + 1] - self.position))
            if not chunk:
                raise ValueError('Truncated archive part')
            chunks.append(chunk)
            remaining -= len(chunk)
            self.position += len(chunk)
        return b''.join(chunks)

    def close(self):
        if self.stream:
            self.stream.close()
        super().close()


def checked_paths(index, directory):
    if index.get('schemaVersion') != 1 or not index.get('parts'):
        raise ValueError('Unsupported or empty archive index')
    filename = index['filename']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.zip', filename):
        raise ValueError('Unsafe archive filename')
    paths = []
    total = hashlib.sha256()
    byte_count = 0
    for number, part in enumerate(index['parts'], 1):
        if part['id'] != f'part{number:03d}':
            raise ValueError('Archive parts are missing or out of order')
        name = part['path']
        if Path(name).name != name or '\\' in name or '/' in name:
            raise ValueError('Part filename must be a basename')
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != part['size']:
            raise ValueError('Missing, linked or wrong-sized part: ' + name)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(BLOCK), b''):
                digest.update(block)
                total.update(block)
                byte_count += len(block)
        if digest.hexdigest() != part['sha256']:
            raise ValueError('Checksum mismatch: ' + name)
        paths.append(path)
    if byte_count != index['size'] or total.hexdigest() != index['sha256']:
        raise ValueError('Joined archive identity differs')
    return paths


def safe_members(archive):
    seen = set()
    infos = archive.infolist()
    for member in infos:
        name = member.orig_filename
        path = PurePosixPath(name)
        mode = member.external_attr >> 16
        if (name != member.filename or path.is_absolute() or not path.parts or '\\' in name or ':' in name
                or any(part in ('', '.', '..') for part in path.parts)
                or name != path.as_posix() or member.is_dir()
                or stat.S_ISLNK(mode) or member.flag_bits & 1
                or any(part.rstrip(' .') != part for part in path.parts)
                or any(re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I) for part in path.parts)):
            raise ValueError('Unsafe ZIP entry: ' + name)
        folded = name.casefold()
        if folded in seen:
            raise ValueError('Duplicate ZIP entry: ' + name)
        seen.add(folded)
    if any('/'.join(PurePosixPath(name).parts[:i]).casefold() in seen
           for name in seen for i in range(1, len(PurePosixPath(name).parts))):
        raise ValueError('A ZIP file conflicts with a containing directory')
    return infos


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true', help='Verify all downloaded bytes and ZIP paths without extracting')
    parser.add_argument('--output', type=Path, help='New extraction directory; default is the archive name without .zip')
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    index = json.loads((directory / 'archive.json').read_text(encoding='utf-8'))
    paths = checked_paths(index, directory)
    with PartsReader(paths) as source, zipfile.ZipFile(source) as archive:
        infos = safe_members(archive)
        if args.verify_only:
            print(f'Verified {len(paths)} parts, {index["size"]} ZIP bytes and {len(infos)} safe entries. No analysis was run.')
            return
        output = (args.output or (directory / index['filename'][:-4])).resolve()
        if output.exists():
            raise FileExistsError('Choose a new output directory: ' + str(output))
        # Validate every target before creating or writing the output directory.
        targets = [(member, output / member.filename) for member in infos]
        if not all(target.resolve().is_relative_to(output) for _, target in targets):
            raise ValueError('Archive path escapes extraction directory')
        output.mkdir(parents=True)
        for member, target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, target.open('xb') as dst:
                shutil.copyfileobj(src, dst, BLOCK)
        print('Verified and extracted complete package to ' + str(output))
        print('Read README.md there, then change to ' + index['rootDirectory'] + ' for analysis commands.')


if __name__ == '__main__':
    main()
'''


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(BLOCK_SIZE), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_source(source: Path, relative: str) -> Path:
    path = PurePosixPath(relative)
    if path.is_absolute() or not path.parts or '\\' in relative or ':' in relative or any(p in ('.', '..') for p in path.parts) or path.as_posix() != relative:
        raise ValueError('Unsafe source-manifest path: ' + relative)
    candidate = source / relative
    if candidate.is_symlink() or not candidate.resolve().is_relative_to(source) or not candidate.is_file():
        raise ValueError('Missing or external source file: ' + relative)
    return candidate


def source_inventory(source: Path):
    candidates = ['analysis/release_manifest.json', 'evidence/package_manifest.json', 'PACKAGE_MANIFEST.json']
    present = [name for name in candidates if (source / name).is_file()]
    if len(present) != 1:
        raise ValueError('Expected exactly one supported release manifest')
    manifest_name = present[0]
    manifest = json.loads((source / manifest_name).read_text(encoding='utf-8'))
    raw = manifest.get('entries', manifest.get('files'))
    if isinstance(raw, dict):
        rows = {name: dict(value) for name, value in raw.items()}
    elif isinstance(raw, list):
        rows = {row['path']: {k: v for k, v in row.items() if k != 'path'} for row in raw}
        if len(rows) != len(raw):
            raise ValueError('Duplicate release-manifest entries')
    else:
        raise ValueError('Invalid release manifest')
    for name, expected in rows.items():
        path = safe_source(source, name)
        if path.stat().st_size != expected['bytes']:
            raise ValueError('Source size differs: ' + name)
        if not re.fullmatch(r'[0-9a-f]{64}', expected['sha256']):
            raise ValueError('Invalid source checksum: ' + name)
    for name in set(manifest.get('self_excluded', [])) | {manifest_name}:
        if (source / name).is_file():
            path = safe_source(source, name)
            rows[name] = {'bytes': path.stat().st_size, 'sha256': sha256(path)}
    return manifest_name, dict(sorted(rows.items()))


class SplitWriter(io.RawIOBase):
    def __init__(self, directory: Path, filename: str, part_size: int):
        super().__init__()
        self.directory, self.filename, self.part_size = directory, filename, part_size
        directory.mkdir()
        self.parts = []
        self.stream = None
        self.position = 0
        self.total = hashlib.sha256()
        self.part_digest = None
        self.part_bytes = 0

    def writable(self):
        return True

    def tell(self):
        return self.position

    def write(self, data):
        view = memoryview(data)
        original_length = len(view)
        while view:
            if self.stream is None:
                number = len(self.parts) + 1
                self.path = self.directory / f'{self.filename}.{number:03d}'
                self.stream = self.path.open('xb')
                self.part_digest = hashlib.sha256()
                self.part_bytes = 0
            chunk = view[:self.part_size - self.part_bytes]
            self.stream.write(chunk)
            self.part_digest.update(chunk)
            self.total.update(chunk)
            self.part_bytes += len(chunk)
            self.position += len(chunk)
            view = view[len(chunk):]
            if self.part_bytes == self.part_size:
                self.finish_part()
        return original_length

    def finish_part(self):
        if self.stream is not None:
            self.stream.close()
            self.stream = None
            self.parts.append({'id': f'part{len(self.parts) + 1:03d}', 'path': self.path.name,
                               'size': self.part_bytes, 'sha256': self.part_digest.hexdigest()})

    def close(self):
        self.finish_part()
        super().close()


def json_bytes(value) -> bytes:
    return (json.dumps(value, indent=2) + '\n').encode('utf-8')


def assembly_namespace():
    namespace = {'__name__': 'reviewer_assembly_library'}
    exec(compile(ASSEMBLER, '<reviewer-assembler>', 'exec'), namespace)
    return namespace


def reviewer_readme(repository: Path, source: Path) -> bytes:
    original = (repository / 'README.md').read_text(encoding='utf-8')
    def adjust(match):
        target = match.group(2)
        if '://' in target or target.startswith('#'):
            return match.group(0)
        if not (source / target.split('#')[0]).is_file():
            raise ValueError('README link is not in the research package: ' + target)
        return f'[{match.group(1)}]({source.name}/{target})'
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', adjust, original)
    prefix = ('# Complete reviewer package\n\n'
              'Keep `archive.json`, `assemble.py` and every numbered ZIP part in one folder. '
              'Run `python assemble.py --verify-only` to check the download, then '
              '`python assemble.py` to verify and extract into a new directory. '
              'The helper uses only the Python standard library and does not run the analysis. '
              'No additional joined ZIP copy is needed. Existing output directories are never overwritten.\n\n'
              f'After extraction, change into `{source.name}/` before using the analysis commands below. '
              'The original research-package files and their recorded identities are preserved.\n\n')
    return (prefix + text).encode('utf-8')


def build(source: Path, repository: Path, name: str, part_size=PART_SIZE):
    source, repository = source.resolve(), repository.resolve()
    if not source.is_dir() or not repository.is_dir():
        raise ValueError('Source and repository must be existing directories')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name) or name.endswith('.zip'):
        raise ValueError('Name must be a plain archive stem without .zip')
    if not 1 <= part_size <= PART_SIZE:
        raise ValueError('Part size must be between 1 byte and 48 MiB')
    destination = repository / 'reviewer'
    if destination.exists():
        raise FileExistsError('Reviewer package already exists; preserve it before an explicit replacement')
    manifest_name, rows = source_inventory(source)
    total_source = sum(row['bytes'] for row in rows.values())
    print(f'Checking {len(rows)} files ({total_source} bytes) against the release inventory.', flush=True)
    for relative, expected in rows.items():
        if sha256(safe_source(source, relative)) != expected['sha256']:
            raise ValueError('Source checksum differs: ' + relative)
    # The ZIP can expand slightly for incompressible files; reserve room for overhead.
    if shutil.disk_usage(repository).free < total_source + max(64 * 1024 * 1024, total_source // 100):
        raise OSError('Insufficient space for a worst-case complete archive')
    readme = reviewer_readme(repository, source)
    filename = name + '.zip'
    temporary = Path(tempfile.mkdtemp(prefix='.reviewer-package-', dir=repository)).resolve()
    if temporary.parent != repository:
        raise ValueError('Unexpected temporary directory')
    try:
        (temporary / 'README.md').write_bytes(readme)
        (temporary / 'assemble.py').write_text(ASSEMBLER, encoding='utf-8', newline='\n')
        expected_entries = {'README.md': {'bytes': len(readme), 'sha256': hashlib.sha256(readme).hexdigest()}}
        writer = SplitWriter(temporary / 'parts', filename, part_size)
        with writer:
            with zipfile.ZipFile(writer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
                entries = [('README.md', None, readme)] + [(source.name + '/' + rel, rel, None) for rel in rows]
                for index, (arcname, relative, inline) in enumerate(entries):
                    info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info._compresslevel = 1
                    info.create_system = 3
                    info.external_attr = 0o100644 << 16
                    digest = hashlib.sha256()
                    with archive.open(info, 'w', force_zip64=True) as dst:
                        if relative is None:
                            dst.write(inline)
                        else:
                            with safe_source(source, relative).open('rb') as src:
                                for block in iter(lambda: src.read(BLOCK_SIZE), b''):
                                    digest.update(block)
                                    dst.write(block)
                            if digest.hexdigest() != rows[relative]['sha256']:
                                raise ValueError('Source changed while packaging: ' + relative)
                            expected_entries[arcname] = rows[relative]
                    if index and index % 1000 == 0:
                        print(f'Archived {index}/{len(rows)} research files.', flush=True)
        index = {'schemaVersion': 1, 'filename': filename, 'size': writer.position,
                 'sha256': writer.total.hexdigest(), 'rootDirectory': source.name,
                 'sourceFiles': len(rows), 'sourceBytes': total_source,
                 'sourceManifest': manifest_name, 'sourceManifestSha256': rows[manifest_name]['sha256'],
                 'parts': writer.parts}
        (temporary / 'archive.json').write_bytes(json_bytes(index))
        namespace = assembly_namespace()
        paths = [temporary / 'parts' / part['path'] for part in writer.parts]
        print('Checking every archived file against the original bytes.', flush=True)
        with namespace['PartsReader'](paths) as stream, zipfile.ZipFile(stream) as archive:
            infos = namespace['safe_members'](archive)
            if {info.filename for info in infos} != set(expected_entries):
                raise ValueError('ZIP inventory differs from the complete source package')
            for info in infos:
                expected = expected_entries[info.filename]
                if info.file_size != expected['bytes']:
                    raise ValueError('ZIP size differs: ' + info.filename)
                with archive.open(info) as content:
                    digest = hashlib.file_digest(content, 'sha256').hexdigest()
                if digest != expected['sha256']:
                    raise ValueError('ZIP content differs: ' + info.filename)
        files = []
        for file_id, relative in [('readme', 'README.md'), ('assemble', 'assemble.py'), ('archive-index', 'archive.json')] + [(p['id'], 'parts/' + p['path']) for p in writer.parts]:
            path = temporary / relative
            files.append({'id': file_id, 'path': 'reviewer/' + relative, 'size': path.stat().st_size, 'sha256': sha256(path)})
        package = {'schemaVersion': 1, 'filename': filename, 'size': index['size'], 'sha256': index['sha256'], 'files': files}
        (temporary / 'package.json').write_bytes(json_bytes(package))
        # Both resolved targets are checked within the explicit repository before moving.
        if temporary.parent != repository or destination.resolve().parent != repository or destination.exists():
            raise ValueError('Unsafe or occupied final package destination')
        temporary.rename(destination)
        print(json.dumps({'package': 'reviewer/package.json', 'sourceFiles': len(rows), 'archiveBytes': writer.position,
                          'parts': len(writer.parts), 'sha256': index['sha256'], 'verified': True}), flush=True)
        return package
    finally:
        if temporary.exists():
            if temporary.resolve().parent != repository:
                raise ValueError('Refusing cleanup outside repository')
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Complete research package with its original release manifest')
    parser.add_argument('--repository', type=Path, required=True, help='Private investigation content checkout containing the concise README')
    parser.add_argument('--name', required=True, help='Download archive stem, without .zip')
    args = parser.parse_args()
    build(args.source, args.repository, args.name)


if __name__ == '__main__':
    main()
