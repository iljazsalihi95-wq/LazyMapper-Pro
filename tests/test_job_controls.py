import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from server import Queue

class JobControls(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.policy = patch('server.target')
        self.policy.start()
        self.q = Queue(os.path.join(self.folder.name, 'jobs.db'), {'fixture.example'})
        self.job = self.q.submit('https://fixture.example/live?token=secret', 'Fixture')

    def tearDown(self):
        self.policy.stop()
        self.folder.cleanup()

    def test_pause_resume_cancel_and_restart(self):
        self.assertEqual(self.q.control(self.job, 'pause')['state'], 'PAUSED')
        self.assertFalse(self.q.tick())
        self.q = Queue(self.q.path, self.q.hosts)
        self.assertEqual(self.q.get(self.job)['state'], 'PAUSED')
        self.assertEqual(self.q.control(self.job, 'resume')['state'], 'QUEUED')
        self.assertEqual(self.q.control(self.job, 'cancel')['state'], 'CANCELLED')
        self.assertFalse(self.q.tick())
        with self.q.db() as db:
            self.assertEqual(db.execute('SELECT url FROM jobs').fetchone()[0], '')
        self.assertEqual(self.q.get(self.job)['progress'], 100)
        self.assertNotIn('secret', str(self.q.events(self.job)))

    def test_control_wins_over_inflight_completion(self):
        for action, expected in [('pause', 'PAUSED'), ('cancel', 'CANCELLED')]:
            if self.q.get(self.job)['state'] == 'PAUSED':
                self.q.control(self.job, 'resume')
            entered, release = threading.Event(), threading.Event()
            def analyze(*args):
                entered.set()
                release.wait(2)
                return {'status': 'WORKING'}
            with patch('server.analyze', side_effect=analyze):
                worker = threading.Thread(target=self.q.tick)
                worker.start()
                self.assertTrue(entered.wait(1))
                self.q.control(self.job, action)
                release.set()
                worker.join(2)
                self.assertFalse(worker.is_alive())
            self.assertEqual(self.q.get(self.job)['state'], expected)

    def test_backoff_and_auth_rate_limit_stop(self):
        with patch('server.analyze', return_value={'status': 'TIMEOUT'}):
            self.q.tick()
            self.assertFalse(self.q.tick())
        self.assertGreater(self.q.get(self.job)['next_run'], 0)
        for result, state in [({'status': 'AUTH REQUIRED'}, 'AUTH_REQUIRED'),
                              ({'status': 'RATE LIMITED', 'http_status': 429}, 'RATE_LIMITED')]:
            with self.q.db() as db:
                db.execute("UPDATE jobs SET state='QUEUED',next_run=0")
            with patch('server.analyze', return_value=result):
                self.q.tick()
            self.assertEqual(self.q.get(self.job)['state'], state)
            self.assertFalse(self.q.tick())

    def test_invalid_transitions(self):
        with self.assertRaises(ValueError):
            self.q.control(self.job, 'resume')
        self.assertIsNone(self.q.control('missing', 'cancel'))

class ControlAPI(unittest.TestCase):
    def test_authenticated_controls_and_logs(self):
        import json
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        from server import handler
        with tempfile.TemporaryDirectory() as folder, patch('server.target'):
            queue = Queue(os.path.join(folder, 'api.db'), {'fixture.example'})
            job = queue.submit('https://fixture.example/live', 'Fixture')
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(queue, 'x'*40, set()))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = 'http://127.0.0.1:'+str(server.server_port)+'/api/jobs/'+job
            def call(path, body=None, token='x'*40):
                req = urllib.request.Request(base+path, data=body, headers={'Authorization': 'Bearer '+token})
                with urllib.request.urlopen(req, timeout=2) as response:
                    return json.load(response)
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    call('/cancel', b'{}', 'invalid')
                self.assertEqual(error.exception.code, 401)
                self.assertEqual(call('/pause', b'{}')['state'], 'PAUSED')
                self.assertEqual(call('/resume', b'{}')['state'], 'QUEUED')
                self.assertEqual(call('/cancel', b'{}')['state'], 'CANCELLED')
                self.assertEqual(len(call('/logs')), 3)
                self.assertNotIn('https:', str(call('/logs')))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
