"""Small synthetic-package checks; no astronomy calculations or network access."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-reviewer-package.py'))
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class ReviewerPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reviewer-package-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'Research'
        self.repo = self.root / 'repository'
        self.source.mkdir()
        self.repo.mkdir()
        (self.source / 'paper.pdf').write_bytes(b'paper fixture')
        (self.source / 'data.bin').write_bytes(bytes(range(256)) * 32)
        (self.source / 'README.txt').write_text('Original pinned documentation.\n', encoding='utf-8')
        (self.repo / 'README.md').write_text('# Review\n\n[Paper](paper.pdf)\n', encoding='utf-8')
        self.rows = {p.name: {'bytes': p.stat().st_size, 'sha256': PREPARE.sha256(p)} for p in self.source.iterdir()}
        (self.source / 'analysis').mkdir()
        self.manifest = self.source / 'analysis/release_manifest.json'
        self.manifest.write_text(json.dumps({'files': [{'path': name, **value} for name, value in self.rows.items()]}), encoding='utf-8')

    def build(self, repo=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return PREPARE.build(self.source, repo or self.repo, 'Research-reviewer', part_size=256)

    def flatten(self):
        download = self.root / 'download'
        download.mkdir()
        package = json.loads((self.repo / 'reviewer/package.json').read_text())
        for row in package['files']:
            shutil.copyfile(self.repo / row['path'], download / Path(row['path']).name)
        return download

    def test_complete_deterministic_archive_and_flat_download(self):
        before = {p.relative_to(self.source).as_posix(): p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        first = self.build()
        self.assertIn('parts/', (self.repo / 'reviewer/.gitignore').read_text())
        self.assertGreater(len(first['files']), 5)
        second_repo = self.root / 'repository2'
        second_repo.mkdir()
        shutil.copyfile(self.repo / 'README.md', second_repo / 'README.md')
        second = self.build(second_repo)
        self.assertEqual(first, second)
        download = self.flatten()
        verify = subprocess.run([sys.executable, '-B', str(download / 'assemble.py'), '--verify-only'], capture_output=True, text=True)
        self.assertEqual(verify.returncode, 0, verify.stderr)
        self.assertFalse((download / 'Research-reviewer').exists())
        extract = subprocess.run([sys.executable, '-B', str(download / 'assemble.py')], capture_output=True, text=True)
        self.assertEqual(extract.returncode, 0, extract.stderr)
        output = download / 'Research-reviewer'
        for relative, expected in before.items():
            self.assertEqual((output / 'Research' / relative).read_bytes(), expected)
            self.assertEqual((self.source / relative).read_bytes(), expected)
        self.assertIn('[Paper](Research/paper.pdf)', (output / 'README.md').read_text())
        repeat = subprocess.run([sys.executable, '-B', str(download / 'assemble.py')], capture_output=True, text=True)
        self.assertNotEqual(repeat.returncode, 0)

    def test_tampered_input_fails_before_publication(self):
        (self.source / 'paper.pdf').write_bytes(b'changed bytes')
        with self.assertRaises(ValueError):
            self.build()
        self.assertFalse((self.repo / 'reviewer').exists())

    def test_missing_input_fails(self):
        (self.source / 'paper.pdf').unlink()
        with self.assertRaises(ValueError):
            self.build()

    def test_corrupt_part_fails_before_extract(self):
        self.build()
        download = self.flatten()
        part = sorted(download.glob('*.zip.*'))[0]
        payload = bytearray(part.read_bytes())
        payload[0] ^= 1
        part.write_bytes(payload)
        result = subprocess.run([sys.executable, '-B', str(download / 'assemble.py')], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((download / 'Research-reviewer').exists())

    def test_missing_part_fails_before_extract(self):
        self.build()
        download = self.flatten()
        sorted(download.glob('*.zip.*'))[0].unlink()
        result = subprocess.run([sys.executable, '-B', str(download / 'assemble.py')], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((download / 'Research-reviewer').exists())

    def test_symlink_zip_entry_rejected(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            info = zipfile.ZipInfo('linked-file')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, b'../outside')
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive, self.assertRaises(ValueError):
            PREPARE.assembly_namespace()['safe_members'](archive)

    def test_linked_source_rejected(self):
        outside = self.root / 'outside.bin'
        outside.write_bytes(b'outside')
        link = self.source / 'link.bin'
        try:
            link.symlink_to(outside)
        except OSError as error:
            self.skipTest('Creating symlinks unavailable: ' + str(error))
        with self.assertRaises(ValueError):
            PREPARE.safe_source(self.source, 'link.bin')

    def test_safe_zip_members(self):
        check = PREPARE.assembly_namespace()['safe_members']
        for names in (['../escape'], ['/absolute'], ['C:/drive'], ['a\\b'], ['CON.txt'], ['a', 'A'], ['a', 'a/b'], ['trailing.']):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name in names:
                    info = zipfile.ZipInfo('placeholder')
                    # Preserve hostile separators rather than ZipInfo's Windows normalization.
                    info.filename = name
                    archive.writestr(info, b'x')
            stream.seek(0)
            with zipfile.ZipFile(stream) as archive, self.assertRaises(ValueError, msg=str(names)):
                check(archive)

    def test_alternative_inventory_formats_preserve_self_excluded(self):
        self.manifest.unlink()
        grb = self.source / 'evidence/package_manifest.json'
        grb.parent.mkdir()
        grb.write_text(json.dumps({'entries': [{'path': name, **value} for name, value in self.rows.items()], 'self_excluded': ['evidence/package_manifest.json']}))
        name, rows = PREPARE.source_inventory(self.source)
        self.assertEqual(name, 'evidence/package_manifest.json')
        self.assertEqual(set(rows), set(self.rows) | {name})
        grb.unlink()
        stellar = self.source / 'PACKAGE_MANIFEST.json'
        stellar.write_text(json.dumps({'files': self.rows, 'self_excluded': ['PACKAGE_MANIFEST.json']}))
        name, rows = PREPARE.source_inventory(self.source)
        self.assertEqual(name, 'PACKAGE_MANIFEST.json')
        self.assertEqual(set(rows), set(self.rows) | {name})

    def test_reject_unsafe_manifest_and_existing_package(self):
        self.manifest.write_text(json.dumps({'files': [{'path': '../paper.pdf', 'bytes': 1, 'sha256': '0' * 64}]}))
        with self.assertRaises(ValueError):
            PREPARE.source_inventory(self.source)
        (self.repo / 'reviewer').mkdir()
        with self.assertRaises(FileExistsError):
            self.build()


if __name__ == '__main__':
    unittest.main()
