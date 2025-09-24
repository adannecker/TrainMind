# -*- coding: utf-8 -*-
from fitparse import FitFile
from pathlib import Path


def inspect_fit(path: Path):
    print(path)
    fitfile = FitFile(str(path))

    print("=== Message Types in File ===")
    for m in fitfile.get_messages():
        if m.name != "record":
            print(m.name)
    print()

    print("=== Erste Record-Felder ===")
    for record in fitfile.get_messages("record"):
        for field in record:
            print(f"{field.name}: {field.value}")
        break  # nur den ersten Record anzeigen

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parents[3]  # zurück bis Repo-Root
    fit_path = base_dir / "data" / "rouvy_test.fit"
    inspect_fit(fit_path)

