"""Bounded selective SEC bulk ZIP retrieval; no holdings download, no retries."""
import io
import re
import time
import urllib.request
import zipfile
from email.utils import parsedate_to_datetime

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("SEC download redirects are not allowed")

MEMBERS = ('SUBMISSION.tsv', 'FUND_REPORTED_INFO.tsv')

class _Ranges(io.RawIOBase):
    def __init__(self, url, user_agent):
        self.url, self.user_agent, self.position = url, user_agent, 0
        self.opener = urllib.request.build_opener(_NoRedirect())
        self.used, self.calls, self.last_request = 0, 0, 0.0
        with self._open('HEAD') as response:
            self.length = int(response.headers['Content-Length'])
            self.last_modified = response.headers.get('Last-Modified')
            etag = response.headers.get('ETag')
            if etag and re.fullmatch(r'"[^"\r\n]+"', etag):
                self.validator_header, self.validator = 'ETag', etag
            else:
                try:
                    valid_date = parsedate_to_datetime(self.last_modified)
                    if valid_date.tzinfo is None: raise ValueError('No timezone')
                except (TypeError, ValueError, IndexError) as exc:
                    raise ValueError('Missing usable archive consistency validator') from exc
                self.validator_header, self.validator = 'Last-Modified', self.last_modified
        if not 22 <= self.length <= 1_000_000_000:
            raise ValueError('Archive outside allowed size')

    def _open(self, method='GET', headers=None):
        if self.calls >= 20:
            raise ValueError('Request budget exceeded')
        time.sleep(max(0, 0.5 - (time.monotonic() - self.last_request)))
        self.calls += 1; self.last_request = time.monotonic()
        request = urllib.request.Request(self.url, method=method,
            headers={'User-Agent': self.user_agent, 'Accept-Encoding': 'identity', **(headers or {})})
        # Errors including 403/429 propagate. Never bypass or aggressively retry.
        response = self.opener.open(request, timeout=30)
        if response.geturl() != self.url:
            response.close()
            raise ValueError('Unexpected redirected response URL')
        return response

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.position
    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.length + offset
        if position < 0 or position > self.length: raise ValueError('Invalid archive seek')
        self.position = position
        return position
    def read(self, size=-1):
        size = self.length - self.position if size < 0 else min(size, self.length-self.position)
        if not size: return b''
        if size > 16_000_000 or self.used + size > 32_000_000:
            raise ValueError('Download byte budget exceeded')
        start, end = self.position, self.position + size - 1
        with self._open(headers={'Range': f'bytes={start}-{end}', 'If-Range': self.validator}) as response:
            if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{self.length}':
                raise ValueError('Server did not honor exact range; stop rather than download full archive')
            if response.headers.get(self.validator_header) != self.validator:
                raise ValueError('Archive changed during retrieval')
            data = response.read(size+1)
        if len(data) != size: raise ValueError('Truncated or oversized range')
        self.position += size; self.used += size
        return data


def fetch(vintage, user_agent):
    """Provide real app/contact identity; coordinate <=10 req/s across all clients.

    Returns the two verified, CRC-checked member bytes and HTTP metadata. Store
    outside source control. Caller owns caching and retrieval timestamps.
    """
    if not re.fullmatch(r'20\d{2}q[1-4]', vintage): raise ValueError('Expected YYYYqN')
    if not user_agent or '@' not in user_agent or '\n' in user_agent or '\r' in user_agent:
        raise ValueError('SEC User-Agent must include a real contact email')
    url = f'https://www.sec.gov/files/dera/data/form-n-port-data-sets/{vintage}_nport.zip'
    remote = _Ranges(url, user_agent)
    result = {}
    with zipfile.ZipFile(remote) as archive:
        for name in MEMBERS:
            matches = [info for info in archive.infolist() if info.filename == name]
            if len(matches) != 1 or matches[0].file_size > 32_000_000:
                raise ValueError('Missing/duplicate/oversized SEC member')
            result[name] = archive.read(matches[0])
    return result, {'source_http_last_modified': remote.last_modified, 'downloaded_bytes': remote.used,
                    'archive_bytes': remote.length, 'requests': remote.calls}
