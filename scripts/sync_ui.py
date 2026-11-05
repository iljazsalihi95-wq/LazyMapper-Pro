"""Generate existing AppCreator entry points and a minimal Worker asset directory."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
pages = {'Kryesor':'servers','Stalker_STB':'stalker','Xtream':'xtream','M3U':'m3u','Diagnostika':'diagnostics'}
for name, page in pages.items():
    # Initial section selection only; all entry points share identical behavior.
    target = html.replace('const initialPage=location.hash.slice(1);',
                          f'const initialPage=location.hash.slice(1)||"{page}";')
    (root / 'appcreator24' / f'LazyMapper_{name}_AppCreator24.html').write_text(target)
public = root / 'cloudflare' / 'public'
public.mkdir(exist_ok=True)
for name in ['index.html','ballina.html','server.html','diagnostika.html']:
    (public / name).write_bytes((root / name).read_bytes())
