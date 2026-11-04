"""Local-only browser checks; financial fixtures are never shipped in the app."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
base='http://127.0.0.1:5173'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1100})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/api/v1/status',lambda route:route.fulfill(json={'state':'empty','last_success':None,'error':None}))
 page.route('**/api/v1/snapshot',lambda route:route.fulfill(status=503,json={'detail':'No snapshot'}))
 page.goto(base)
 page.get_by_text('No data connection.',exact=True).wait_for()
 assert page.locator('path.country').count()==177
 assert page.locator('path.holding-arc').count()==0
 page.get_by_placeholder('Search name or ISO code…').fill('Vatican')
 assert page.locator('select').nth(1).locator('option').count()==2
 page.get_by_text('Reset view ↗',exact=True).click()
 page.screenshot(path='/tmp/atlas-desktop.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
 page.screenshot(path='/tmp/atlas-mobile.png',full_page=True)
 fixture={'countries':[],'positions':[{'reporter_iso3':'USA','counterpart_iso3':'JPN','value_usd':1000000,'period':'2025-S2','source_id':'test','record_id':'test-1'}], 'sources':[], 'metadata':{'concept':'position','asset_class':'equity','unit_verified':True,'period':'2025-S2','version':'test-only'}}
 page.unroute('**/api/v1/status');page.unroute('**/api/v1/snapshot')
 page.route('**/api/v1/status',lambda route:route.fulfill(json={'state':'ready','last_success':None,'error':None}))
 page.route('**/api/v1/snapshot',lambda route:route.fulfill(json=fixture))
 page.get_by_role('button',name='Refresh data').click()
 page.locator('path.holding-arc').wait_for()
 assert page.locator('tbody tr').count()==1
 page.locator('select').nth(1).select_option('USA')
 page.locator('select').nth(2).select_option('issued_by')
 assert page.locator('tbody tr').count()==0
 assert page.locator('path.holding-arc').count()==0
 page.get_by_text('Reset view ↗',exact=True).click()
 assert page.locator('path.holding-arc').count()==1
 page.unroute('**/api/v1/snapshot');page.route('**/api/v1/snapshot',lambda route:route.fulfill(status=503,json={}))
 page.get_by_role('button',name='Refresh data').click()
 page.get_by_text('No data connection.',exact=True).wait_for()
 assert page.locator('path.holding-arc').count()==0
 assert page.locator('tbody tr').count()==0
 assert not errors,errors
 browser.close()
 print('PASS: 177 polygons, search, no synthetic data, mobile overflow, directional filters, refresh failure clears edges; no browser errors')
