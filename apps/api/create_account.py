from __future__ import annotations

import argparse
import sys

from apps.api.auth_service import create_user


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a local TrainMind account.")
    parser.add_argument("--email", required=True, help="Account email")
    parser.add_argument("--password", required=True, help="Account password")
    parser.add_argument("--display-name", default="", help="Optional display name")
    args = parser.parse_args()

    try:
        result = create_user(args.email, args.password, args.display_name or None)
        print(f"Account created: {result['email']}")
        return 0
    except Exception as exc:
        print(f"Failed to create account: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

