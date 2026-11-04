import os
from fastapi import FastAPI,HTTPException,Request,Response
from fastapi.middleware.cors import CORSMiddleware
from financeflow.store import Store
from financeflow.registry import countries
from financeflow.contracts import Snapshot
app=FastAPI(title='FinanceFlowAtlas',version='0.2.0')
store=Store(os.getenv('FFA_DATA_DIR','var')+'/state.sqlite')
# Local Vite development only. Production should serve API and UI under one origin.
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET'],allow_headers=['If-None-Match'])
@app.get('/api/v1/status')
def status():return store.status()
@app.get('/api/v1/countries')
def registry():return [c.model_dump() for c in countries()]
@app.get('/api/v1/snapshot',response_model=Snapshot)
def snapshot(request:Request,response:Response):
    s=store.latest()
    if s is None:raise HTTPException(503,detail='No validated source snapshot. Run ingestion first.')
    etag='"'+s.metadata.version+'"'
    if request.headers.get('if-none-match')==etag:return Response(status_code=304,headers={'ETag':etag})
    response.headers['ETag']=etag;response.headers['Cache-Control']='no-cache'
    return s.model_dump()

# Transactions have a distinct schema and storage; never replace the holdings snapshot.
from financeflow.tic_service import router as tic_router
app.include_router(tic_router())

# SEC fund-share activity remains separate from country holdings and TIC transactions.
from financeflow.sec_nport_service import router as sec_nport_router
app.include_router(sec_nport_router())

# BOP national transactions remain distinct; unresolved monetary units stay gated.
from financeflow.bop_service import router as bop_router
app.include_router(bop_router())
