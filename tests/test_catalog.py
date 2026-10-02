import base64
import unittest
from unittest.mock import patch
from umbrel_push.catalog import NO_ICON, image_data, automatic_icon, search_images
from umbrel_push.package import generate, validate


class CatalogTests(unittest.TestCase):
    def test_no_icon_is_embedded_and_upload_roundtrips(self):
        data = base64.b64decode(NO_ICON.split(',')[1])
        self.assertEqual(image_data(data), NO_ICON)
        manifest, _ = validate(generate('test', 'nginx', 'Test', 80, 18080))
        self.assertEqual(manifest['icon'], NO_ICON)

    def test_non_image_and_oversize_rejected(self):
        for data in (b'<script>bad</script>', b'\x89PNG\r\n\x1a\n' + b'0' * 1048576):
            with self.assertRaises(ValueError):
                image_data(data)

    def test_missing_automatic_match_leaves_blank(self):
        with patch('umbrel_push.catalog.download', side_effect=OSError):
            self.assertIsNone(automatic_icon('example/missing:latest'))

    def test_search_encodes_query_and_returns_repositories(self):
        with patch('umbrel_push.catalog.download', return_value=b'{"results":[{"repo_name":"nginx"}]}') as download:
            self.assertEqual(search_images('some image')[0]['repo_name'], 'nginx')
            self.assertIn('query=some+image', download.call_args.args[0])

