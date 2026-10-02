"""Small, bounded public catalog requests. No Docker credentials required."""
import base64
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

NO_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='


def download(url, limit=1024 * 1024):
    with urlopen(Request(url, headers={'User-Agent': 'UmbrelPush/0.1'}), timeout=8) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Response exceeds the size limit.')
    return data


def search_images(query):
    query = query.strip()
    if not query:
        return []
    url = 'https://hub.docker.com/v2/search/repositories/?' + urlencode({'query': query, 'page_size': 25})
    return json.loads(download(url))['results']


def hub_repository(image):
    """Docker Hub namespace/name for an image reference, or None for other registries."""
    repository = image.split('@')[0].strip()
    last = repository.rsplit('/', 1)[-1]
    if ':' in last:
        repository = repository.rsplit(':', 1)[0]
    parts = repository.split('/')
    if not repository or len(parts) > 2 or ('.' in parts[0] or ':' in parts[0] or parts[0] == 'localhost') and len(parts) > 1:
        return None
    if len(parts) == 1:
        parts = ['library', parts[0]]
    if parts[0] in ('docker.io',):
        return None
    if not all(re.fullmatch(r'[a-z0-9][a-z0-9._-]*', p) for p in parts):
        return None
    return '/'.join(parts)


def image_tags(image, limit=50):
    """Recent tags for a Docker Hub image, newest first. Empty for other registries."""
    repository = hub_repository(image)
    if not repository:
        return []
    url = f'https://hub.docker.com/v2/repositories/{repository}/tags?' + urlencode({'page_size': limit, 'ordering': 'last_updated'})
    results = json.loads(download(url)).get('results', [])
    return [r['name'] for r in results if isinstance(r.get('name'), str)]


def image_data(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        mime = 'image/webp'
    else:
        raise ValueError('Choose a PNG, JPEG, or WebP image.')
    if len(data) > 1024 * 1024:
        raise ValueError('Icon must be smaller than 1 MiB.')
    return f'data:{mime};base64,' + base64.b64encode(data).decode()


def automatic_icon(image):
    slug = image.split('@')[0].rsplit('/', 1)[-1].split(':')[0].lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', slug):
        return None
    url = f'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/{slug}.png'
    try:
        return image_data(download(url))
    except Exception:
        return None
