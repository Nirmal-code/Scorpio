import json
import data_loader.news_fetcher as nf
from openai import OpenAI
import os

class AIEvaluator:
    def __init__(self):
        self.evaluation = {}
        self.model = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    

    def model_evaluation(self, profile, metrics, news):

        content = json.dumps({
            "profile": profile,
            "metrics": metrics,
            "news": news
        })

        response = self.model.chat.completions.create(
            model="o3-mini",
            messages=[
                {"role": "system", "content": (
                    "You are my personal AI financial news analyst. "
                    "You will take my personal data, metrics of stocks I have invested and use given news articles related to those stocks and just tell me what my course of action should be today. "
                    "Keep it relevant to today only, and make sure each jot note is explicit on which stock it is talking about. "
                )},
                {"role": "user", "content": content}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "personal_financial_analysis",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "summary": {
                                "type": "array",
                                "items": { "type": "string" }
                            },
                            "recommendation": {
                                "type": "array",
                                "items": { "type": "string" }
                            }
                        },
                        "required": ["summary", "recommendation"]
                    }
                }
            }
        )

        choice = response.choices[0].message

        # With JSON schema, the SDK may provide a parsed object; otherwise parse the string.
        if hasattr(choice, "parsed") and choice.parsed is not None:
            parsed = choice.parsed
        else:
            raw = choice.content
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw  # fallback to raw string if parsing fails

        return parsed

        # message is a ChatCompletionMessage; use .content instead of subscription

    def print_evaluated_news(self):
        for ticker, evaluation in self.evaluated_news.items():
            print(f"\nTicker: {ticker} - Evaluation:")
            if isinstance(evaluation, str):
                print(evaluation)
            else:
                print(json.dumps(evaluation, indent=2))
