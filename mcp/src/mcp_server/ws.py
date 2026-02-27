import json
import os
from getpass import getpass
from dotenv import load_dotenv
from ws_api import WealthsimpleAPI, OTPRequiredException, LoginFailedException, WSAPISession

# Load repo-level .env if present (used for username only)
load_dotenv()


class WSApi:
    def get_holdings(self):
        WealthsimpleAPI.set_user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/132.0.0.0 Safari/537.36"
        )

        # Login fresh each run (no persistence)
        username = os.getenv("WS_USERNAME") or input("Wealthsimple username (email): ")
        password = None  # always prompt; do not read from env
        otp_answer = None
        while True:
            try:
                if not password:
                    password = getpass("Password: ")
                session = WealthsimpleAPI.login(
                    username,
                    password,
                    otp_answer,
                    persist_session_fct=None,
                )
                break
            except OTPRequiredException:
                otp_answer = getpass("TOTP code: ")
            except LoginFailedException:
                print("Login failed. Try again.")
                password = None
                otp_answer = None

        # Use the session to build the API client
        ws = WealthsimpleAPI.from_token(session, None, username)

        # Fetch positions across all accounts and print only holdings
        positions = ws.get_identity_positions(
            security_ids=None,
            currency="CAD",
        )

        def resolve_symbol(pos):
            security = pos.get("security") or {}
            stock = security.get("stock") or {}
            symbol = stock.get("symbol") or security.get("id")
            security_id = security.get("id")
            if security_id and (not symbol or str(symbol).startswith("sec-")):
                try:
                    md = ws.get_security_market_data(security_id, use_cache=False)
                    stock_md = md.get("stock") if isinstance(md, dict) else None
                    if isinstance(stock_md, dict):
                        symbol = stock_md.get("symbol") or symbol
                except Exception:
                    pass
            return symbol

        def normalize_position(pos):
            symbol = resolve_symbol(pos)
            avg_price = (pos.get("averagePrice") or {}).get("amount")
            total_value = (pos.get("totalValue") or {}).get("amount")
            book_value = (pos.get("bookValue") or {}).get("amount")
            accounts = pos.get("accounts") or []
            account_id = (
                accounts[0].get("id") if accounts and isinstance(accounts[0], dict) else None
            )
            return {
                "ticker": symbol,
                "quantity": pos.get("quantity"),
                "avg_cost": avg_price,
                "market_value": total_value,
                "book_value": book_value,
                "account_id": account_id,
            }

        holdings = [normalize_position(p) for p in positions or []]
        print(json.dumps(holdings, indent=2))
        return holdings


if __name__ == "__main__":
    WSApi().get_holdings()
