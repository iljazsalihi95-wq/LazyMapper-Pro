"""Private queue API. Run behind HTTPS; configuration is exclusively environment based."""
import csv
import hmac
import io
import json
import os
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from analyzer import analyze, target


class Queue:
    def __init__(self, path, hosts):
        self.path, self.hosts = path, hosts
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, url TEXT, name TEXT, state TEXT, attempts INTEGER DEFAULT 0, result TEXT, created REAL, updated REAL)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(jobs)')}
            if 'next_run' not in columns:
                db.execute('ALTER TABLE jobs ADD COLUMN next_run REAL DEFAULT 0')
            db.execute("CREATE TABLE IF NOT EXISTS events (job TEXT, state TEXT, at REAL)")
            db.execute("UPDATE jobs SET state='QUEUED',next_run=0 WHERE state='RUNNING'")

    def db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def submit(self, url, name):
        target(url, self.hosts)
        with self.db() as db:
            # Dedupe active jobs. Single API lock below serializes submissions.
            prior = db.execute("SELECT id FROM jobs WHERE url=? AND state IN ('QUEUED','RUNNING','PAUSED')", (url,)).fetchone()
            if prior:
                return prior['id']
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('QUEUED','RUNNING','PAUSED')").fetchone()[0] >= 100:
                raise ValueError('Queue is full (100 jobs)')
            job = secrets.token_urlsafe(18)
            db.execute('INSERT INTO jobs (id,url,name,state,attempts,result,created,updated) VALUES (?,?,?,?,?,?,?,?)',
                       (job, url, str(name)[:200], 'QUEUED', 0, None, time.time(), time.time()))
            return job

    def get(self, job=None):
        with self.db() as db:
            rows = db.execute('SELECT id,name,state,attempts,result,created,updated,next_run FROM jobs WHERE id=?' if job else
                              'SELECT id,name,state,attempts,result,created,updated,next_run FROM jobs ORDER BY created DESC LIMIT 500',
                              (job,) if job else ()).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item['result'] = json.loads(item['result']) if item['result'] else None
            item['progress'] = 100 if item['state'] in ('DONE', 'CANCELLED', 'AUTH_REQUIRED', 'RATE_LIMITED') else 0
            out.append(item)
        return out[0] if job and out else None if job else out

    def control(self, job, action):
        transitions = {'pause': ('PAUSED', ('QUEUED', 'RUNNING')),
                       'resume': ('QUEUED', ('PAUSED',)),
                       'cancel': ('CANCELLED', ('QUEUED', 'RUNNING', 'PAUSED'))}
        if action not in transitions:
            raise ValueError('Unknown action')
        state, allowed = transitions[action]
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT state FROM jobs WHERE id=?', (job,)).fetchone()
            if not row:
                return None
            if row['state'] not in allowed:
                raise ValueError('Invalid state transition')
            db.execute("UPDATE jobs SET state=?,updated=?,next_run=0,url=CASE WHEN ?='CANCELLED' THEN '' ELSE url END WHERE id=?",
                       (state, time.time(), state, job))
            db.execute('INSERT INTO events VALUES (?,?,?)', (job, state, time.time()))
        return self.get(job)

    def events(self, job):
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT state,at FROM events WHERE job=? ORDER BY at DESC LIMIT 100', (job,))]

    def tick(self):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM jobs WHERE state='QUEUED' AND next_run<=? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return False
            db.execute("UPDATE jobs SET state='RUNNING', attempts=attempts+1,updated=? WHERE id=?", (time.time(), row['id']))
        try:
            result = analyze(row['url'], self.hosts)
        except Exception:
            # A failed analyzer must not leave this job RUNNING forever.
            # Exception text may contain credentials; retain a fixed diagnostic only.
            result = {'status': 'UNKNOWN', 'playback': 'NOT TESTED',
                      'error': 'Analyzer failed unexpectedly'}
        # Signed/query URLs remain only in the private job while pending. Do not persist them in history.
        result.pop('final_url', None)
        retry = result['status'] == 'TIMEOUT' and row['attempts'] < 3
        state = ('AUTH_REQUIRED' if result['status'] == 'AUTH REQUIRED' else
                 'RATE_LIMITED' if result.get('http_status') == 429 else
                 'QUEUED' if retry else 'DONE')
        next_run = time.time() + min(300, 30 * 2 ** row['attempts']) if retry else 0
        with self.db() as db:
            # A control request during I/O wins over late completion.
            changed = db.execute("UPDATE jobs SET state=?,result=?,url=?,updated=?,next_run=? WHERE id=? AND state='RUNNING' AND attempts=?",
                       (state, json.dumps(result), row['url'] if retry else '', time.time(), next_run, row['id'], row['attempts'] + 1)).rowcount
            if changed:
                db.execute('INSERT INTO events VALUES (?,?,?)', (row['id'], state, time.time()))
            db.execute("DELETE FROM jobs WHERE state='DONE' AND updated<?", (time.time()-30*86400,))
        return True

    def worker(self, stop):
        while not stop.is_set():
            try:
                self.tick()
            except Exception:
                # No URL, passwords or tokens in logs. Running jobs recover on restart.
                pass
            stop.wait(1)  # one worker, bounded requests, no aggressive parallel scan


def handler(queue, token, origins):
    lock = threading.Lock()

    class API(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def authorized(self):
            origin = self.headers.get('Origin')
            return (not origin or origin in origins) and hmac.compare_digest(
                self.headers.get('Authorization', '').encode('utf-8'), ('Bearer '+token).encode('utf-8'))

        def send_api_headers(self, code, content_type='application/json'):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            origin = self.headers.get('Origin')
            if origin in origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()

        def reply(self, code, value):
            self.send_api_headers(code)
            self.wfile.write(json.dumps(value).encode())

        def do_OPTIONS(self):
            if self.headers.get('Origin') not in origins:
                return self.reply(403, {'error': 'Origin not configured'})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.end_headers()

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {'error': 'AUTH REQUIRED'})
            path = urlsplit(self.path).path
            if path == '/api/health':
                return self.reply(200, {'ok': True, 'worker': 'single bounded worker'})
            if path == '/api/history':
                return self.reply(200, queue.get())
            if path == '/api/history.csv':
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(['id', 'name', 'state', 'status', 'checked_at', 'response_ms', 'playback', 'error'])
                for item in queue.get():
                    r = item['result'] or {}
                    name = item['name']
                    if name.startswith(('=', '+', '-', '@', '\t', '\r')):
                        name = "'"+name
                    writer.writerow([item['id'], name, item['state']] + [r.get(k, '') for k in
                                     ('status', 'checked_at', 'response_ms', 'playback', 'error')])
                self.send_api_headers(200, 'text/csv; charset=utf-8')
                return self.wfile.write(out.getvalue().encode())
            if path.startswith('/api/jobs/') and path.endswith('/logs'):
                return self.reply(200, queue.events(path.split('/')[-2]))
            if path.startswith('/api/jobs/'):
                item = queue.get(path.rsplit('/', 1)[1])
                return self.reply(200 if item else 404, item or {'error': 'Not found'})
            return self.reply(404, {'error': 'Not found'})

        def do_POST(self):
            if not self.authorized():
                return self.reply(401, {'error': 'AUTH REQUIRED'})
            parts = urlsplit(self.path).path.strip('/').split('/')
            if len(parts) == 4 and parts[:2] == ['api', 'jobs']:
                try:
                    item = queue.control(parts[2], parts[3])
                    return self.reply(200 if item else 404, item or {'error': 'Not found'})
                except ValueError:
                    return self.reply(409, {'error': 'Invalid job action or state'})
            if self.path != '/api/jobs':
                return self.reply(404, {'error': 'Not found'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 16384:
                    raise ValueError('Request size invalid')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('Object required')
                url = body.get('url', '')
                if not isinstance(url, str) or len(url) > 8192:
                    raise ValueError('URL size invalid')
                with lock:
                    job = queue.submit(url, body.get('name', 'Stream'))
                return self.reply(202, {'id': job, 'state': 'QUEUED'})
            except (ValueError, OSError):
                return self.reply(400, {'error': 'Invalid URL, host/port not authorized, or queue full'})

    return API


def main():
    token = os.environ.get('LM_ADMIN_TOKEN', '')
    hosts = {s.strip().lower() for s in os.environ.get('LM_ALLOWED_HOSTS', '').split(',') if s.strip()}
    if len(token) < 32 or not hosts:
        raise SystemExit('Set LM_ADMIN_TOKEN (32+ characters) and LM_ALLOWED_HOSTS')
    os.umask(0o077)
    queue = Queue(os.getenv('LM_DB', 'mapper.sqlite3'), hosts)
    origins = {s.strip() for s in os.getenv('LM_ORIGINS', '').split(',') if s.strip()}
    stop = threading.Event()
    thread = threading.Thread(target=queue.worker, args=(stop,), daemon=True)
    thread.start()
    server = ThreadingHTTPServer((os.getenv('LM_BIND', '127.0.0.1'), int(os.getenv('LM_PORT', '8787'))), handler(queue, token, origins))
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()
        thread.join(timeout=30)


if __name__ == '__main__':
    main()
