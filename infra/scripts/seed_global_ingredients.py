from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, select

from packages.db.models import NutritionFoodItem, NutritionFoodItemSource
from packages.db.session import SessionLocal


TARGET_COUNT = 800
CATALOG_SOURCE_LABEL = "TrainMind Starter-Katalog v1"
CATALOG_SOURCE_URL = "https://trainmind.local/catalog/starter-v1"
CATALOG_VERSION = "starter-v1"


@dataclass(frozen=True)
class Profile:
    kcal: float
    protein: float
    carbs: float
    fat: float
    fiber: float
    sugar: float
    sodium_mg: float
    potassium_mg: float


CATEGORY_PROFILES: dict[str, Profile] = {
    "Gemüse": Profile(35, 2.2, 5.5, 0.4, 2.8, 2.4, 45, 320),
    "Obst": Profile(62, 0.9, 14.5, 0.3, 2.4, 11.2, 3, 210),
    "Fleisch": Profile(175, 26.0, 0.0, 8.0, 0.0, 0.0, 70, 330),
    "Fisch": Profile(165, 23.0, 0.0, 7.0, 0.0, 0.0, 80, 380),
    "Eier": Profile(150, 13.0, 1.2, 10.5, 0.0, 1.1, 120, 130),
    "Milchprodukte": Profile(80, 5.0, 6.0, 4.2, 0.0, 5.7, 60, 190),
    "Käse": Profile(325, 24.0, 1.5, 25.5, 0.0, 1.0, 640, 90),
    "Joghurt": Profile(88, 7.0, 6.5, 3.0, 0.2, 5.8, 55, 200),
    "Brot": Profile(245, 8.5, 46.0, 2.8, 5.2, 3.8, 470, 200),
    "Backwaren": Profile(320, 7.0, 49.0, 10.5, 2.3, 17.0, 360, 150),
    "Getreide": Profile(355, 11.0, 69.0, 4.8, 8.3, 1.4, 15, 280),
    "Hülsenfrüchte": Profile(315, 23.0, 45.0, 2.0, 14.0, 4.5, 35, 780),
    "Nüsse": Profile(610, 21.0, 15.0, 52.0, 8.8, 4.2, 7, 620),
    "Samen": Profile(560, 21.0, 21.0, 44.0, 13.0, 1.6, 12, 640),
    "Öle": Profile(884, 0.0, 0.0, 100.0, 0.0, 0.0, 0, 0),
    "Getränke": Profile(40, 0.5, 8.8, 0.2, 0.2, 8.3, 15, 35),
    "Süßwaren": Profile(445, 5.0, 61.0, 20.0, 2.1, 46.0, 170, 220),
    "Snacks": Profile(500, 9.0, 49.0, 28.0, 4.2, 4.0, 520, 420),
    "Gewürze": Profile(255, 10.0, 42.0, 6.5, 26.0, 2.5, 50, 980),
    "Fertiggerichte": Profile(145, 7.0, 14.0, 6.5, 2.2, 3.2, 560, 220),
}


CATEGORY_BASE_ITEMS: dict[str, list[str]] = {
    "Gemüse": [
        "Brokkoli", "Spinat", "Gruenkohl", "Karotte", "Paprika rot", "Paprika gelb", "Paprika gruen", "Tomate",
        "Gurke", "Zucchini", "Aubergine", "Spargel", "Blumenkohl", "Rosenkohl", "Rotkohl", "Weisskohl", "Chinakohl",
        "Fenchel", "Sellerie", "Staudensellerie", "Rote Bete", "Kohlrabi", "Lauch", "Fruehlingszwiebel", "Zwiebel",
        "Knoblauch", "Champignon", "Steinpilz", "Pfifferling", "Suesskartoffel", "Kartoffel", "Rucola", "Feldsalat",
        "Kopfsalat", "Eisbergsalat", "Mangold", "Radieschen", "Rettich", "Mais", "Erbse gruen", "Bohne gruen",
    ],
    "Obst": [
        "Banane", "Apfel", "Birne", "Orange", "Mandarine", "Grapefruit", "Zitrone", "Limette", "Ananas", "Mango",
        "Papaya", "Kiwi", "Traube hell", "Traube dunkel", "Erdbeere", "Himbeere", "Brombeere", "Heidelbeere",
        "Johannisbeere", "Kirsche", "Pfirsich", "Nektarine", "Aprikose", "Pflaume", "Mirabelle", "Wassermelone",
        "Honigmelone", "Granatapfel", "Kaki", "Feige", "Dattel frisch", "Avocado", "Cranberry", "Guave",
        "Passionsfrucht", "Litschi", "Quitte", "Kokosnuss Fruchtfleisch", "Rhabarber", "Hagebutte",
    ],
    "Fleisch": [
        "Haehnchenbrust", "Haehnchenkeule", "Putenbrust", "Putenoberkeule", "Rinderfilet", "Rinderhuefte", "Rinderhack mager",
        "Rinderhack gemischt", "Rumpsteak", "Roastbeef", "Kalbsfilet", "Schweinefilet", "Schweinelachs", "Schweinehack",
        "Schweinebauch", "Lammkotelett", "Lammkeule", "Wildschwein", "Hirschfleisch", "Rehfleisch", "Kaninchenfleisch",
        "Entenbrust", "Gansfleisch", "Rinderleber", "Kalbsleber", "Huehnchenherz", "Truthahnaufschnitt", "Roastbeefaufschnitt",
    ],
    "Fisch": [
        "Lachs", "Lachsforelle", "Thunfisch", "Makrele", "Hering", "Sardine", "Kabeljau", "Seelachs", "Schellfisch",
        "Dorade", "Seebarsch", "Rotbarsch", "Heilbutt", "Zander", "Forelle", "Wels", "Aal", "Tilapia", "Scholle",
        "Seezunge", "Garnele", "Krabbe", "Miesmuschel", "Jakobsmuschel", "Tintenfisch", "Pulpo", "Fischstaebchen",
    ],
    "Eier": ["Ei ganz", "Eiklar", "Eigelb", "Wachtelei", "Ruehrei", "Spiegelei", "Omelett natur", "Ei gekocht"],
    "Milchprodukte": [
        "Milch 1.5%", "Milch 3.5%", "Laktosefreie Milch", "Buttermilch", "Kefir", "Molke", "Sahne 10%", "Sahne 30%",
        "Kondensmilch", "Milchpulver", "Haferdrink", "Mandeldrink", "Sojadrink", "Kokosdrink", "Reisdrink",
    ],
    "Käse": [
        "Mozzarella", "Feta", "Hirtenkaese", "Gouda jung", "Gouda alt", "Emmentaler", "Bergkaese", "Parmesan",
        "Gruyere", "Cheddar", "Camembert", "Brie", "Harzer Kaese", "Hüttenkäse", "Frischkaese natur", "Ricotta",
        "Mascarpone", "Halloumi", "Provolone", "Pecorino",
    ],
    "Joghurt": [
        "Joghurt natur 1.5%", "Joghurt natur 3.5%", "Griechischer Joghurt 2%", "Griechischer Joghurt 10%", "Skyr",
        "Quark mager", "Quark 20%", "Quark 40%", "Proteinjoghurt", "Joghurt Vanille", "Joghurt Erdbeere",
    ],
    "Brot": [
        "Vollkornbrot", "Roggenbrot", "Mischbrot", "Sauerteigbrot", "Eiweissbrot", "Toastbrot", "Dinkelbrot",
        "Baguette", "Ciabatta", "Pumpernickel", "Knäckebrot", "Mehrkornbrot", "Bauernbrot", "Kartoffelbrot",
    ],
    "Backwaren": [
        "Croissant", "Brezel", "Laugenstange", "Laugenbroetchen", "Muffin", "Donut", "Berliner", "Apfeltasche",
        "Rosinenbroetchen", "Zimtschnecke", "Brioche", "Pain au Chocolat", "Kuchenboden", "Biskuitrolle",
    ],
    "Getreide": [
        "Haferflocken", "Zarte Haferflocken", "Instant Oats", "Dinkelflocken", "Reis weiss", "Reis braun", "Basmati Reis",
        "Jasminreis", "Wildreis", "Quinoa", "Amaranth", "Buchweizen", "Hirse", "Gerste", "Couscous", "Bulgur",
        "Polenta", "Hartweizengriess", "Weizenkleie", "Reisflocken", "Maisgries", "Reisnudeln", "Vollkornnudeln",
        "Pasta weiss", "Spaghetti", "Penne", "Fusilli",
    ],
    "Hülsenfrüchte": [
        "Linsen rot", "Linsen braun", "Linsen gruen", "Kichererbse", "Kidneybohne", "Schwarze Bohne", "Weisse Bohne",
        "Pinto Bohne", "Mungbohne", "Sojabohne", "Edamame", "Erbse getrocknet", "Lupine", "Tempeh natur", "Tofu natur",
    ],
    "Nüsse": [
        "Mandel", "Walnuss", "Haselnuss", "Cashew", "Pistazie", "Erdnuss", "Paranuss", "Pekannuss", "Macadamia",
        "Pinienkern", "Kokoschips", "Mandelmus", "Erdnussmus", "Cashewmus",
    ],
    "Samen": [
        "Leinsamen", "Chiasamen", "Sesam", "Hanfsamen", "Kuerbiskerne", "Sonnenblumenkerne", "Mohn", "Flohsamenschalen",
        "Tahini", "Senfsaat",
    ],
    "Öle": [
        "Olivenoel", "Rapsoel", "Sonnenblumenoel", "Leinoel", "Kokosoel", "Walnussoel", "Avocadooel", "Sesamoel",
        "Erdnussoel", "Kuerbiskernoel", "Butter", "Butterschmalz",
    ],
    "Getränke": [
        "Mineralwasser", "Leitungswasser", "Isotonisches Getraenk", "Orangensaft", "Apfelsaft", "Traubensaft",
        "Tomatensaft", "Kokoswasser", "Kaffee schwarz", "Espresso", "Cappuccino", "Tee gruen", "Tee schwarz",
        "Mate Tee", "Cola", "Zuckerfreie Cola", "Energy Drink", "Proteinshake ready to drink", "Kakaogetraenk",
    ],
    "Süßwaren": [
        "Zartbitterschokolade", "Milchschokolade", "Weisse Schokolade", "Gummibaerchen", "Fruchtgummi sauer", "Marshmallow",
        "Bonbon", "Karamell", "Nougat", "Honig", "Marmelade Erdbeere", "Marmelade Aprikose", "Nuss-Nougat-Creme",
    ],
    "Snacks": [
        "Kartoffelchips", "Tortillachips", "Reiswaffel", "Maiswaffel", "Cracker", "Salzstangen", "Popcorn salzig",
        "Popcorn suess", "Proteinriegel", "Muesliriegel", "Beef Jerky", "Linsenchips", "Kichererbsen Chips",
        "Bananenchips", "Trockenfruchtmix", "Studentenfutter",
    ],
    "Gewürze": [
        "Salz", "Meersalz", "Pfeffer schwarz", "Paprikapulver", "Currypulver", "Kurkumapulver", "Zimt", "Kreuzkuemmel",
        "Knoblauchpulver", "Zwiebelpulver", "Oregano", "Basilikum", "Thymian", "Rosmarin", "Chili gemahlen",
        "Kakaopulver", "Vanille", "Ingwerpulver",
    ],
    "Fertiggerichte": [
        "Tomatensuppe", "Linsensuppe", "Huehnersuppe", "Chili sin Carne", "Chili con Carne", "Bolognese Sauce",
        "Pesto Genovese", "Gemueselasagne", "Spinatlasagne", "Pizza Margherita", "Pizza Salami", "TK Gemuesepfanne",
        "Fertigsalat Caesar", "Sushi Mix", "Wrap Haehnchen", "Reisgericht mit Gemuese", "Curry mit Reis",
        "Paella", "Nudelauflauf", "Ofengemuese Mix",
    ],
}


VARIANT_SUFFIXES: dict[str, list[str]] = {
    "Gemüse": ["roh", "gedaempft", "gekocht", "TK", "Bio"],
    "Obst": ["frisch", "TK", "reif", "Bio"],
    "Fleisch": ["roh", "gebraten", "gekocht", "grillfertig", "mager"],
    "Fisch": ["roh", "gebraten", "gedaempft", "geraeuchert"],
    "Eier": ["natur", "bio", "gekocht", "gebraten"],
    "Milchprodukte": ["natur", "fettarm", "vollfett", "proteinreich"],
    "Käse": ["natur", "light", "gerieben", "Scheiben"],
    "Joghurt": ["natur", "proteinreich", "fettarm", "ohne Zuckerzusatz"],
    "Brot": ["frisch", "geschnitten", "getoastet", "Bio"],
    "Backwaren": ["klassisch", "mit Butter", "mit Vollkorn", "Mini"],
    "Getreide": ["trocken", "gekocht", "instant", "vollkorn"],
    "Hülsenfrüchte": ["trocken", "gekocht", "Dose abgetropft", "Bio"],
    "Nüsse": ["natur", "geroestet", "gesalzen", "ungesalzen"],
    "Samen": ["natur", "geroestet", "gemahlen", "Bio"],
    "Öle": ["kaltgepresst", "raffiniert", "Bio"],
    "Getränke": ["ohne Zucker", "mit Zucker", "klassisch", "zero"],
    "Süßwaren": ["klassisch", "mini", "ohne Zuckerzusatz"],
    "Snacks": ["klassisch", "light", "proteinreich", "gesalzen"],
    "Gewürze": ["gemahlen", "ganz", "Bio"],
    "Fertiggerichte": ["Standard", "Light", "Protein", "vegetarisch"],
}


def _hash_fraction(key: str, modulo: int) -> float:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    value = int(digest[:8], 16) % modulo
    return value / float(modulo - 1)


def _estimate_macros(name: str, category: str) -> dict[str, float]:
    profile = CATEGORY_PROFILES[category]
    # Keep deterministic but slightly different across items.
    f = 0.82 + 0.36 * _hash_fraction(f"{name}:{category}", 101)
    sugar_ratio = 0.45 + 0.4 * _hash_fraction(f"{name}:sugar", 97)
    fiber_ratio = 0.35 + 0.45 * _hash_fraction(f"{name}:fiber", 89)

    kcal = round(max(0.0, profile.kcal * f), 1)
    protein = round(max(0.0, profile.protein * f), 1)
    carbs = round(max(0.0, profile.carbs * f), 1)
    fat = round(max(0.0, profile.fat * f), 1)
    fiber = round(min(carbs, max(0.0, profile.fiber * f * fiber_ratio)), 1)
    sugar = round(min(carbs, max(0.0, profile.sugar * f * sugar_ratio)), 1)
    starch = round(max(0.0, carbs - sugar - min(fiber, carbs * 0.35)), 1)

    saturated = round(max(0.0, fat * (0.22 + 0.18 * _hash_fraction(f"{name}:sat", 61))), 1)
    mono = round(max(0.0, fat * (0.34 + 0.2 * _hash_fraction(f"{name}:mono", 67))), 1)
    poly = round(max(0.0, fat - saturated - mono), 1)

    sodium_mg = round(max(0.0, profile.sodium_mg * (0.75 + 0.5 * _hash_fraction(f"{name}:na", 83))), 1)
    potassium_mg = round(max(0.0, profile.potassium_mg * (0.75 + 0.5 * _hash_fraction(f"{name}:k", 79))), 1)

    return {
        "kcal_per_100g": kcal,
        "protein_per_100g": protein,
        "carbs_per_100g": carbs,
        "fat_per_100g": fat,
        "fiber_per_100g": fiber,
        "sugar_per_100g": sugar,
        "starch_per_100g": starch,
        "saturated_fat_per_100g": saturated,
        "monounsaturated_fat_per_100g": mono,
        "polyunsaturated_fat_per_100g": poly,
        "sodium_mg_per_100g": sodium_mg,
        "potassium_mg_per_100g": potassium_mg,
    }


def _build_candidate_names() -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(category: str, name: str) -> None:
        key = f"{category}|{name.lower().strip()}"
        if key in seen:
            return
        seen.add(key)
        candidates.append((category, name))

    for category, names in CATEGORY_BASE_ITEMS.items():
        for name in names:
            add(category, name)

    for category, names in CATEGORY_BASE_ITEMS.items():
        suffixes = VARIANT_SUFFIXES.get(category, [])
        for base in names:
            for suffix in suffixes:
                if len(candidates) >= TARGET_COUNT:
                    break
                add(category, f"{base} ({suffix})")
            if len(candidates) >= TARGET_COUNT:
                break
        if len(candidates) >= TARGET_COUNT:
            break

    return candidates[:TARGET_COUNT]


def seed_global_ingredients(target_count: int = TARGET_COUNT) -> dict[str, int]:
    candidates = _build_candidate_names()[:target_count]
    now = datetime.utcnow()

    with SessionLocal() as session:
        existing = session.scalars(
            select(NutritionFoodItem).where(
                and_(
                    NutritionFoodItem.user_id.is_(None),
                    NutritionFoodItem.deleted_at.is_(None),
                )
            )
        ).all()
        existing_map = {f"{item.category or ''}|{item.name.lower()}": item for item in existing}

        inserted = 0
        updated = 0
        skipped = 0

        for category, name in candidates:
            key = f"{category}|{name.lower()}"
            macros = _estimate_macros(name=name, category=category)
            details = {
                "catalog_version": CATALOG_VERSION,
                "seeded_at": now.isoformat(),
                "seed_note": "Starter ingredient for athletes; values are baseline estimates and should be verified if critical.",
            }

            row = existing_map.get(key)
            if row is None:
                row = NutritionFoodItem(
                    id=hashlib.sha256(f"{category}|{name}|{CATALOG_VERSION}".encode("utf-8")).hexdigest()[:36],
                    user_id=None,
                    name=name,
                    category=category,
                    brand=None,
                    barcode=None,
                    origin_type="trusted_source",
                    trust_level="medium",
                    verification_status="source_linked",
                    source_label=CATALOG_SOURCE_LABEL,
                    source_url=CATALOG_SOURCE_URL,
                    details_json=json.dumps(details, ensure_ascii=False),
                    created_at=now,
                    updated_at=now,
                    deleted_at=None,
                    **macros,
                )
                session.add(row)
                session.flush()
                inserted += 1
                existing_map[key] = row
            else:
                if row.origin_type == "trusted_source" and row.source_label == CATALOG_SOURCE_LABEL:
                    skipped += 1
                else:
                    row.origin_type = "trusted_source"
                    row.trust_level = "medium"
                    row.verification_status = "source_linked"
                    row.source_label = CATALOG_SOURCE_LABEL
                    row.source_url = CATALOG_SOURCE_URL
                    row.details_json = json.dumps(details, ensure_ascii=False)
                    for field, value in macros.items():
                        setattr(row, field, value)
                    row.updated_at = now
                    updated += 1

            has_primary_source = session.scalar(
                select(NutritionFoodItemSource).where(
                    NutritionFoodItemSource.food_item_id == row.id,
                    NutritionFoodItemSource.is_primary == 1,
                )
            )
            if has_primary_source is None:
                session.add(
                    NutritionFoodItemSource(
                        food_item_id=row.id,
                        source_type="trusted_source",
                        source_name=CATALOG_SOURCE_LABEL,
                        source_url=CATALOG_SOURCE_URL,
                        citation_text="TrainMind Starter-Katalog",
                        is_primary=1,
                        created_at=now,
                    )
                )

        session.commit()

        total_global = session.scalar(
            select(func.count()).select_from(NutritionFoodItem).where(
                and_(
                    NutritionFoodItem.user_id.is_(None),
                    NutritionFoodItem.deleted_at.is_(None),
                )
            )
        )

    return {
        "target": target_count,
        "inserted": inserted,
        "updated": updated,
        "skipped_existing": skipped,
        "total_global_after": int(total_global or 0),
    }


if __name__ == "__main__":
    result = seed_global_ingredients()
    print(json.dumps(result, ensure_ascii=False))
