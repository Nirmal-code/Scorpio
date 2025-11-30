


import json
from pathlib import Path


class PortfolioPipeline:
    def __init__(self):
        # Use repository root relative to this file to avoid cwd-dependent paths
        self.portfolio_path = Path(__file__).resolve().parent.parent / "investment_data" / "profile.json"
   
    def load_portfolio(self):
        if not self.portfolio_path.exists():
            return {}
        return json.loads(self.portfolio_path.read_text())
    

    def save_portfolio(self, data):
        self.portfolio_path.write_text(json.dumps(data, indent=2))
