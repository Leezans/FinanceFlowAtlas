"""Optional standalone SEC API; does not initialize IMF/TIC stores."""
from fastapi import FastAPI
from financeflow.sec_nport_service import router

app = FastAPI(title='FinanceFlowAtlas SEC fund-share flows', version='0.1.0')
app.include_router(router())
