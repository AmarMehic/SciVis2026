import requests
import re
import json
import os
from urllib.parse import urljoin, urlparse
import logging

logger = logging.getLogger("backend.crawl")

BASE_URL = "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/"
OUT_DIR = os.path.join(os.path.dirname(__file__), "debug_samples")
OUT_FILE = os.path.join(OUT_DIR, "crawl_results.json")

HEADERS = {"User-Agent": "sci-vis-crawler/1.0"}

# simple regex to extract href values from directory listing HTML
HREF_RE = re.compile(r'href="([^"]+)"')


def list_links(url):
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10, verify=True)
    except Exception as e:
        logger.exception("HTTP error accessing %s: %s", url, e)
        return []
    if resp.status_code != 200:
        logger.error("Status %s for %s", resp.status_code, url)
        return []
    links = HREF_RE.findall(resp.text)
    # normalize and dedupe
    full = []
    for l in links:
        # skip parent reference
        if l in ("../", "./", "/"):
            continue
        full_url = urljoin(url, l)
        full.append(full_url)
    return list(dict.fromkeys(full))


def crawl(start_url=BASE_URL, max_depth=3):
    logger.info("Starting crawl at %s (depth=%s)", start_url, max_depth)
    visited = set()
    found_idx = set()

    def _crawl(url, depth):
        if depth < 0 or url in visited:
            return
        logger.info("Scanning: %s", url)
        visited.add(url)
        links = list_links(url)
        for link in links:
            lower = link.lower()
            if lower.endswith('.idx'):
                logger.info("Found IDX: %s", link)
                found_idx.add(link)
            elif link.endswith('/'):
                # dive deeper
                _crawl(link, depth - 1)
            else:
                # sometimes directory listings don't end with '/' — still consider
                path = urlparse(link).path
                if path.endswith('/'):
                    _crawl(link, depth - 1)
    
    _crawl(start_url, max_depth)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({"base": start_url, "found": sorted(list(found_idx))}, f, indent=2)

    logger.info("Crawl complete. Found %s .idx files. Results written to %s", len(found_idx), OUT_FILE)
    return sorted(list(found_idx))


if __name__ == '__main__':
    crawl()
