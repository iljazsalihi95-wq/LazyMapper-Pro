import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from analyzer import PolicyError, analyze, decode_sample, http_state, media_sample, target
from server import Queue, handler


class FakeFetch:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    def get(self, url):
        self.calls.append(url)
        return self.responses[len(self.calls)-1]


class AnalyzerTests(unittest.TestCase):
    def test_policy_blocks_private_dns_and_unlisted_hosts(self):
        with self.assertRaises(PolicyError):
            target('https://unlisted.example/file', {'media.example'})
        with patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(PolicyError):
                target('https://media.example/file', {'media.example'})

    def test_policy_rejects_credentials_and_schemes(self):
        for url in ('file:///etc/passwd', 'https://user:pass@media.example/test', 'ftp://media.example/a'):
            with self.assertRaises(PolicyError):
                target(url, {'media.example'})

    def test_http_200_is_not_working(self):
        with patch('analyzer.Fetcher.get', return_value=(200, 'text/html', b'<!doctype html>login', 'https://media.example')):
            result = analyze('https://media.example', {'media.example'})
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(result['playback'], 'NOT TESTED')

    def test_http_states(self):
        self.assertEqual(http_state(403), 'AUTH REQUIRED')
        self.assertEqual(http_state(404), 'UNAVAILABLE')
        self.assertEqual(http_state(200), 'UNKNOWN')

    def test_hls_relative_segment(self):
        fetcher = FakeFetch([(200, 'application/vnd.apple.mpegurl', b'#EXTM3U\n#EXTINF:2,\nsegment.ts', 'https://media.example/live/a.m3u8'),
                             (206, 'video/mp2t', b'media', 'https://media.example/live/segment.ts')])
        result, data = media_sample(fetcher, 'https://media.example/live/a.m3u8')
        self.assertEqual(fetcher.calls[1], 'https://media.example/live/segment.ts')
        self.assertEqual(data, b'media')
        self.assertEqual(result['status'], 'UNKNOWN')

    def test_encrypted_hls_does_not_fetch_key(self):
        fetcher = FakeFetch([(200, 'application/x-mpegurl', b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\nseg.ts', 'https://media.example/a.m3u8')])
        result, sample = media_sample(fetcher, 'https://media.example/a.m3u8')
        self.assertIsNone(sample)
        self.assertEqual(len(fetcher.calls), 1)
        self.assertNotEqual(result['status'], 'WORKING')

    def test_missing_hls_segment(self):
        fetcher = FakeFetch([(200, 'text/plain', b'#EXTM3U\n#EXTINF:2,\nseg.ts', 'https://media.example/a.m3u8'),
                             (404, 'text/plain', b'', 'https://media.example/seg.ts')])
        result, sample = media_sample(fetcher, 'https://media.example/a.m3u8')
        self.assertEqual(result['status'], 'UNAVAILABLE')
        self.assertIsNone(sample)

    def test_actual_decode_generated_media_and_reject_junk(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'test.ts'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25',
                            '-t', '3', '-c:v', 'mpeg2video', '-f', 'mpegts', str(path)], check=True)
            result = decode_sample(path.read_bytes(), time.monotonic()+20)
        self.assertEqual(result['status'], 'WORKING')
        self.assertGreater(result['sample_duration_us'], 0)
        self.assertEqual(result['tracks'][0]['width'], 160)
        self.assertEqual(decode_sample(b'not a stream', time.monotonic()+10)['playback'], 'FAILED')


class QueueTests(unittest.TestCase):
    def test_persistence_retry_recovery_and_history_redaction(self):
        with tempfile.TemporaryDirectory() as folder, patch('server.target'):
            path = os.path.join(folder, 'queue.sqlite3')
            q = Queue(path, {'media.example'})
            job = q.submit('https://media.example/live?secret=private', '=Name')
            self.assertEqual(q.submit('https://media.example/live?secret=private', 'Name'), job)
            with patch('server.analyze', return_value={'status': 'TIMEOUT', 'final_url': 'https://secret'}):
                q.tick()
            self.assertEqual(q.get(job)['state'], 'QUEUED')
            with q.db() as db:
                db.execute("UPDATE jobs SET state='RUNNING'")
            q = Queue(path, {'media.example'})
            with patch('server.analyze', return_value={'status': 'WORKING', 'playback': 'SAMPLE DECODED', 'final_url': 'https://secret'}):
                q.tick()
            self.assertEqual(q.get(job)['state'], 'DONE')
            self.assertNotIn('secret', json.dumps(q.get()))
            with q.db() as db:
                self.assertEqual(db.execute('SELECT url FROM jobs').fetchone()[0], '')

    def test_api_requires_auth_and_denies_other_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            q = Queue(os.path.join(folder, 'db'), {'media.example'})
            token = 'x'*40
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(q, token, {'https://app.example'}))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = 'http://127.0.0.1:'+str(server.server_port)+'/api/history'
            try:
                with self.assertRaises(urllib.error.HTTPError) as err:
                    urllib.request.urlopen(url)
                self.assertEqual(err.exception.code, 401)
                req = urllib.request.Request(url, headers={'Authorization': 'Bearer '+token})
                self.assertEqual(json.load(urllib.request.urlopen(req)), [])
                req.add_header('Origin', 'https://evil.example')
                with self.assertRaises(urllib.error.HTTPError) as err:
                    urllib.request.urlopen(req)
                self.assertEqual(err.exception.code, 401)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
