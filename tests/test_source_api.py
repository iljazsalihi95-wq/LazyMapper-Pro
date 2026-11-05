import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import server
from analyzer import PolicyError


class SourceAPI(unittest.TestCase):
    def test_authenticated_bounded_pinned_source_transport(self):
        with tempfile.TemporaryDirectory() as folder:
            queue = server.Queue(os.path.join(folder, 'queue.db'), {'media.example'})
            api = ThreadingHTTPServer(('127.0.0.1', 0), server.handler(queue, 'fixture-token', set()))
            thread = threading.Thread(target=api.serve_forever, daemon=True)
            thread.start()
            def post(body, token='fixture-token'):
                request = urllib.request.Request('http://127.0.0.1:'+str(api.server_port)+'/api/source',
                    data=json.dumps(body).encode(), headers={'Authorization':'Bearer '+token})
                try:
                    with urllib.request.urlopen(request) as response:
                        return response.status, response.read().decode()
                except urllib.error.HTTPError as response:
                    return response.code, response.read().decode()
            try:
                with patch.object(server.Fetcher, 'get', return_value=(200,'text/plain',b'#EXTM3U\n','https://media.example/list')) as fetch:
                    self.assertEqual(post({'url':'https://media.example/list'}, 'wrong')[0], 401)
                    fetch.assert_not_called()
                    self.assertEqual(post({'url':'https://media.example/list'}), (200,'#EXTM3U\n'))
                for upstream, expected in [(401,401),(403,403),(404,404),(429,429),(500,502)]:
                    with patch.object(server.Fetcher, 'get', return_value=(upstream,'text/plain',b'','')):
                        self.assertEqual(post({'url':'https://media.example/list'})[0], expected)
                with patch.object(server.Fetcher, 'get', side_effect=PolicyError('private secret URL')):
                    code, text=post({'url':'http://127.0.0.1'})
                    self.assertEqual(code,400)
                    self.assertNotIn('secret',text)
                with patch.object(server.Fetcher, 'get', return_value=(200,'text/html',b'<html>login</html>','')):
                    self.assertEqual(post({'url':'https://media.example/list'})[0],415)
                with patch.object(server.Fetcher, 'get', side_effect=TimeoutError()):
                    self.assertEqual(post({'url':'https://media.example/list'})[0],504)
            finally:
                api.shutdown();api.server_close();thread.join()
