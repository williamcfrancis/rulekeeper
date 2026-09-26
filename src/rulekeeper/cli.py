import argparse
import json

from .config import Settings


def main():
    parser = argparse.ArgumentParser(description="RuleKeeper: rules, with receipts.")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser(
        "ingest", help="Download, verify, extract, and embed the official SRD"
    )
    ingest.add_argument("--no-embed", action="store_true", help="Build only the lexical corpus")
    serve = commands.add_parser("serve", help="Serve the API and built web interface")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    evaluate = commands.add_parser(
        "evaluate", help="Measure retrieval against the labeled question set"
    )
    evaluate.add_argument("--split", choices=["dev", "test", "all"], default="test")
    args = parser.parse_args()
    if args.command == "ingest":
        from .ingest import build_index

        print(json.dumps(build_index(Settings(), embed=not args.no_embed), indent=2))
    elif args.command == "serve":
        import uvicorn

        uvicorn.run("rulekeeper.api:app", host=args.host, port=args.port)
    else:
        from .evaluation import evaluate

        print(json.dumps(evaluate(Settings(), split=args.split), indent=2))


if __name__ == "__main__":
    main()
