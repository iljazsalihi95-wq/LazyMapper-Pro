import importlib.util
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


class WorkerFailureTest(unittest.TestCase):
    def test_analyzer_exception_completes_job_and_queue_continues(self):
        fake = types.ModuleType('analyzer')
        fake.target = lambda *args: None
        fake.analyze = lambda *args: None
        spec = importlib.util.spec_from_file_location('worker_under_test', pathlib.Path(__file__).parents[1] / 'backend/server.py')
        server = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'analyzer': fake}):
            spec.loader.exec_module(server)
        with tempfile.TemporaryDirectory() as tmp:
            queue = server.Queue(str(pathlib.Path(tmp) / 'queue.db'), {'media.example'})
            first = queue.submit('https://media.example/first?token=fixture-secret', 'First')
            second = queue.submit('https://media.example/second', 'Second')
            with patch.object(server, 'analyze', side_effect=RuntimeError('fixture-secret')):
                self.assertTrue(queue.tick())
            result = queue.get(first)
            self.assertEqual(result['state'], 'DONE')
            self.assertEqual(result['result']['status'], 'UNKNOWN')
            self.assertNotIn('fixture-secret', str(result))
            with queue.db() as db:
                self.assertEqual(db.execute('SELECT url FROM jobs WHERE id=?', (first,)).fetchone()[0], '')
            with patch.object(server, 'analyze', return_value={'status': 'UNKNOWN', 'playback': 'NOT TESTED'}):
                self.assertTrue(queue.tick())
            self.assertEqual(queue.get(second)['state'], 'DONE')


if __name__ == '__main__':
    unittest.main()
