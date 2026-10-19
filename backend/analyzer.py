"""Bounded, authorized HTTP/HLS inspection. Never treats HTTP success as playback."""
import hashlib
import http.client
import ipaddress
import json
import os
import socket
import ssl
import subprocess
import tempfile
import time
from urllib.parse import urljoin, urlsplit

LIMIT = 4 * 1024 * 1024


class PolicyError(ValueError):
    pass


def target(url, allowed_hosts):
    u = urlsplit(url)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        raise PolicyError('Only HTTP/HTTPS without URL userinfo is supported')
    if u.hostname.lower() not in allowed_hosts:
        raise PolicyError('Host is not in LM_ALLOWED_HOSTS')
    port = u.port or (443 if u.scheme == 'https' else 80)
    if port not in (80, 443) and str(port) not in os.getenv('LM_ALLOWED_PORTS', '').split(','):
        raise PolicyError('Port is not authorized')
    addresses = sorted({a[4][0] for a in socket.getaddrinfo(u.hostname, port, type=socket.SOCK_STREAM)})
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise PolicyError('Private, local and special-use addresses are blocked')
    return u, port, addresses[0]


class PinnedTLS(http.client.HTTPSConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class Fetcher:
    def __init__(self, allowed_hosts, deadline):
        self.allowed_hosts = allowed_hosts
        self.deadline = deadline
        self.chain = []

    def get(self, url):
        for _ in range(6):
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            u, port, address = target(url, self.allowed_hosts)
            timeout = min(5, remaining)
            if u.scheme == 'https':
                conn = PinnedTLS(u.hostname, port, address, timeout)
            else:
                conn = http.client.HTTPConnection(address, port, timeout=timeout)
            try:
                host = u.hostname if port in (80, 443) else f'{u.hostname}:{port}'
                conn.request('GET', (u.path or '/') + ('?' + u.query if u.query else ''),
                             headers={'Host': host, 'Range': f'bytes=0-{LIMIT-1}',
                                      'Accept-Encoding': 'identity', 'User-Agent': 'LazyMapper-Pro/2'})
                response = conn.getresponse()
                self.chain.append({'status': response.status, 'host': u.hostname})
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader('Location')
                    if not location:
                        raise ValueError('Redirect without Location')
                    next_url = urljoin(url, location)
                    if u.scheme == 'https' and urlsplit(next_url).scheme != 'https':
                        raise PolicyError('HTTPS downgrade blocked')
                    url = next_url
                    continue
                data = bytearray()
                if response.status in (200, 206):
                    while len(data) < LIMIT:
                        if time.monotonic() >= self.deadline:
                            raise TimeoutError()
                        chunk = response.read1(min(65536, LIMIT-len(data)))
                        if not chunk:
                            break
                        data.extend(chunk)
                return response.status, response.getheader('Content-Type', ''), bytes(data), url
            finally:
                conn.close()
        raise ValueError('Redirect limit exceeded')


def http_state(status):
    if status in (401, 403):
        return 'AUTH REQUIRED'
    if status in (404, 410):
        return 'UNAVAILABLE'
    return 'UNKNOWN'


def media_sample(fetcher, url):
    status, content_type, data, final = fetcher.get(url)
    result = {'status': http_state(status), 'http_status': status,
              'content_type': content_type, 'final_url': final, 'playback': 'NOT TESTED'}
    if status not in (200, 206):
        return result, None
    if 'text/html' in content_type.lower() or data.lstrip().lower().startswith(b'<!doctype html'):
        result['error'] = 'HTML response, not media'
        return result, None
    for _ in range(3):
        if not data.lstrip(b'\xef\xbb\xbf \r\n').startswith(b'#EXTM3U'):
            return result, data
        text = data.decode('utf-8-sig', errors='replace')
        if '#EXT-X-KEY:' in text and any('METHOD=NONE' not in line for line in text.splitlines() if line.startswith('#EXT-X-KEY:')):
            result.update(status='UNKNOWN', error='Encrypted HLS; no keys fetched or exported')
            return result, None
        if '#EXT-X-SESSION-KEY:' in text:
            result.update(status='UNKNOWN', error='Protected HLS session; key not fetched')
            return result, None
        lines = [x.strip() for x in text.splitlines() if x.strip()]
        uri = next((x for x in lines if not x.startswith('#')), None)
        if not uri:
            result['error'] = 'HLS manifest has no playable URI'
            return result, None
        playlist_url = final
        status, ct, data, child = fetcher.get(urljoin(final, uri))
        result['segment_http_status'] = status
        if status not in (200, 206):
            result.update(status=http_state(status), error='HLS child request failed')
            return result, None
        final = child
        # fMP4 initialization + first fragment; all URIs use the same host policy.
        init = next((x for x in lines if x.startswith('#EXT-X-MAP:')), None)
        if init:
            import re
            match = re.search(r'URI="([^"]+)"', init)
            if match:
                code, _, prefix, _ = fetcher.get(urljoin(playlist_url, match[1]))
                if code not in (200, 206):
                    result['error'] = 'HLS initialization unavailable'
                    return result, None
                data = prefix + data
    result['error'] = 'HLS nesting limit exceeded'
    return result, None


def decode_sample(data, deadline):
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, 'sample.bin')
        with open(path, 'wb') as out:
            out.write(data)
        def run(args):
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            return subprocess.run(args, capture_output=True, timeout=min(8, remaining))
        probe = run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                     '-show_streams', '-show_format', '-of', 'json', path])
        if probe.returncode:
            return {'playback': 'FAILED', 'error': 'Media sample was not recognized'}
        info = json.loads(probe.stdout)
        streams = info.get('streams', [])
        av = [s for s in streams if s.get('codec_type') in ('video', 'audio')]
        if not av:
            return {'playback': 'FAILED', 'error': 'No audio/video tracks'}
        decoded = run(['ffmpeg', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
                       '-i', path, '-t', '2', '-map', '0:v:0?', '-map', '0:a:0?',
                       '-progress', 'pipe:1', '-f', 'null', '-'])
        # Progress alone at EOF is not evidence of a decoded frame/audio sample.
        progress = decoded.stdout.decode(errors='replace')
        import re
        duration = max([int(n) for n in re.findall(r'out_time_us=(\d+)', progress)] or [0])
        passed = decoded.returncode == 0 and duration > 0
        return {'status': 'WORKING' if passed else 'UNKNOWN',
                'playback': 'SAMPLE DECODED' if passed else 'FAILED',
                'sample_duration_us': duration, 'tracks': [
                    {k: s[k] for k in ('codec_type', 'codec_name', 'width', 'height', 'bit_rate') if k in s}
                    for s in streams], 'buffering': 'NOT TESTED',
                'bitrate': info.get('format', {}).get('bit_rate')}


def analyze(url, allowed_hosts):
    start = time.monotonic()
    result = {'status': 'UNKNOWN', 'playback': 'NOT TESTED',
              'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'id': hashlib.sha256(url.encode()).hexdigest()[:24]}
    fetcher = Fetcher(allowed_hosts, start+25)
    try:
        info, sample = media_sample(fetcher, url)
        result.update(info)
        if sample:
            result.update(decode_sample(sample, start+25))
    except (TimeoutError, socket.timeout, subprocess.TimeoutExpired):
        result.update(status='TIMEOUT', error='Inspection deadline exceeded')
    except FileNotFoundError:
        result['error'] = 'ffmpeg/ffprobe is not installed; playback NOT TESTED'
    except PolicyError as error:
        result['error'] = str(error)
    except Exception:
        result['error'] = 'Network, TLS or media inspection failed'
    result.update(response_ms=round((time.monotonic()-start)*1000), redirects=fetcher.chain)
    return result
