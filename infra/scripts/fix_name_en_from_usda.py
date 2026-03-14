from __future__ import annotations

import json
import re
from datetime import datetime

from sqlalchemy import and_, select

from packages.db.models import NutritionFoodItem
from packages.db.session import SessionLocal


SUFFIX_MAP = {
    "roh": "raw",
    "gekocht": "cooked",
    "frisch": "fresh",
    "reif": "ripe",
    "bio": "organic",
    "tk": "frozen",
    "gedaempft": "steamed",
    "geraeuchert": "smoked",
    "kaltgepresst": "cold-pressed",
    "gerieben": "grated",
    "gesalzen": "salted",
    "ungesalzen": "unsalted",
    "leicht": "light",
    "proteinreich": "high-protein",
}

BASE_MAP = {
    "tomate": "tomato",
    "zucchini": "zucchini",
    "paprika rot": "red bell pepper",
    "paprika gelb": "yellow bell pepper",
    "paprika gruen": "green bell pepper",
    "apfel": "apple",
    "birne": "pear",
    "orange": "orange",
    "banane": "banana",
    "ananas": "pineapple",
    "erdbeere": "strawberry",
    "heidelbeere": "blueberry",
    "himbeere": "raspberry",
    "kirsche": "cherry",
    "pfirsich": "peach",
    "aprikose": "apricot",
    "pflaume": "plum",
    "gurke": "cucumber",
    "brokkoli": "broccoli",
    "blumenkohl": "cauliflower",
    "rosenkohl": "brussels sprouts",
    "kohlrabi": "kohlrabi",
    "lauch": "leek",
    "zwiebel": "onion",
    "knoblauch": "garlic",
    "spinat": "spinach",
    "rucola": "arugula",
    "champignon": "button mushroom",
    "kartoffel": "potato",
    "suesskartoffel": "sweet potato",
    "haehnchenbrust": "chicken breast",
    "putenbrust": "turkey breast",
    "rinderhack mager": "lean ground beef",
    "rumpsteak": "rump steak",
    "lachs": "salmon",
    "thunfisch": "tuna",
    "kabeljau": "cod",
    "forelle": "trout",
    "makrele": "mackerel",
    "sardine": "sardine",
    "tilapia": "tilapia",
    "ei ganz": "whole egg",
    "eiklar": "egg white",
    "eigelb": "egg yolk",
    "milch 1.5%": "milk 1.5%",
    "milch 3.5%": "milk 3.5%",
    "joghurt natur 1.5%": "plain yogurt 1.5%",
    "joghurt natur 3.5%": "plain yogurt 3.5%",
    "skyr": "skyr",
    "quark mager": "low-fat quark",
    "huettenkaese": "cottage cheese",
    "mozzarella": "mozzarella",
    "feta": "feta",
    "emmentaler": "emmental",
    "parmesan": "parmesan",
    "haferflocken": "rolled oats",
    "instant oats": "instant oats",
    "reis weiss": "white rice",
    "reis braun": "brown rice",
    "quinoa": "quinoa",
    "bulgur": "bulgur",
    "couscous": "couscous",
    "spaghetti": "spaghetti",
    "knaeckebrot": "crispbread",
    "penne": "penne",
    "kichererbse": "chickpea",
    "linsen rot": "red lentils",
    "kidneybohne": "kidney bean",
    "tofu natur": "tofu plain",
    "tempeh natur": "tempeh plain",
    "mandel": "almond",
    "walnuss": "walnut",
    "haselnuss": "hazelnut",
    "cashew": "cashew",
    "chia": "chia seeds",
    "leinsamen": "flaxseed",
    "sesam": "sesame",
    "kuerbiskerne": "pumpkin seeds",
    "olivenoel": "olive oil",
    "rapsoel": "canola oil",
    "kokosoel": "coconut oil",
}

TOKEN_MAP = {
    "frisch": "fresh",
    "reif": "ripe",
    "roh": "raw",
    "gekocht": "cooked",
    "gedaempft": "steamed",
    "geraeuchert": "smoked",
    "bio": "organic",
    "klassisch": "classic",
    "natur": "plain",
    "fettarm": "low-fat",
    "vollfett": "full-fat",
    "ohne": "without",
    "mit": "with",
    "zucker": "sugar",
    "zuckerzusatz": "added sugar",
    "suess": "sweet",
    "gesalzen": "salted",
    "ungesalzen": "unsalted",
    "kaltgepresst": "cold-pressed",
    "hell": "light",
    "dunkel": "dark",
    "rot": "red",
    "gelb": "yellow",
    "gruen": "green",
    "mager": "lean",
    "gebraten": "fried",
    "gemahlen": "ground",
    "ganz": "whole",
    "getrocknet": "dried",
    "dose": "can",
    "abgetropft": "drained",
    "haehnchen": "chicken",
    "pute": "turkey",
    "rind": "beef",
    "schwein": "pork",
    "fisch": "fish",
    "gemuese": "vegetables",
    "frucht": "fruit",
    "misch": "mix",
    "ohnezucker": "sugar-free",
}


def _normalize(value: str) -> str:
    value = value.strip().lower()
    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    value = re.sub(r"\s+", " ", value)
    return value


def _titlecase(text: str) -> str:
    if not text:
        return text
    return " ".join(part[:1].upper() + part[1:] for part in text.split(" "))


def _translate_tokens(text: str) -> str:
    parts = re.split(r"(\s+|/|-)", text)
    out: list[str] = []
    for part in parts:
        if not part or part.isspace() or part in {"/", "-"}:
            out.append(part)
            continue
        norm = _normalize(part)
        mapped = TOKEN_MAP.get(norm)
        out.append(mapped if mapped else part)
    joined = "".join(out).strip()
    return _titlecase(re.sub(r"\s+", " ", joined))


def _translate_fallback(name: str) -> str:
    text = name.strip()
    match = re.match(r"^(.*?)\s*\((.*?)\)\s*$", text)
    if match:
        base_raw = match.group(1).strip()
        suffix_raw = match.group(2).strip()
    else:
        base_raw = text
        suffix_raw = ""

    base_norm = _normalize(base_raw)
    suffix_norm = _normalize(suffix_raw) if suffix_raw else ""

    base_en = BASE_MAP.get(base_norm, _translate_tokens(base_raw))
    suffix_en = SUFFIX_MAP.get(suffix_norm, suffix_raw) if suffix_raw else ""

    if suffix_en:
        return f"{_titlecase(base_en)} ({suffix_en})"
    return _titlecase(base_en)


def _looks_like_clean_ingredient(desc: str) -> bool:
    # Heuristic: avoid branded/recipe-like or overly verbose USDA descriptions.
    if "," in desc:
        return False
    token_count = len(desc.split())
    if token_count > 5:
        return False
    return True


def _usda_description(details_json: str | None) -> str | None:
    if not details_json:
        return None
    try:
        payload = json.loads(details_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    usda = payload.get("usda")
    if not isinstance(usda, dict):
        return None
    desc = usda.get("description")
    score = usda.get("score")
    if isinstance(desc, str) and desc.strip():
        score_val = float(score) if isinstance(score, (int, float)) else 0.0
        clean_desc = desc.strip()
        if score_val >= 0.8 and _looks_like_clean_ingredient(clean_desc):
            return clean_desc
    return None


def run() -> dict[str, int]:
    updated_from_usda = 0
    updated_from_fallback = 0
    unchanged = 0

    with SessionLocal() as session:
        rows = session.scalars(
            select(NutritionFoodItem).where(
                and_(
                    NutritionFoodItem.deleted_at.is_(None),
                )
            )
        ).all()

        for row in rows:
            current_en = (row.name_en or "").strip()
            source_usda = _usda_description(row.details_json) if row.item_kind == "base_ingredient" else None
            if source_usda:
                candidate = _titlecase(source_usda.lower())
                if current_en != candidate:
                    row.name_en = candidate
                    row.updated_at = datetime.utcnow()
                    updated_from_usda += 1
                else:
                    unchanged += 1
                continue

            fallback = _translate_fallback(row.name_de or row.name or "")
            if fallback and current_en != fallback:
                row.name_en = fallback
                row.updated_at = datetime.utcnow()
                updated_from_fallback += 1
            else:
                unchanged += 1

        session.commit()

    return {
        "updated_from_usda": updated_from_usda,
        "updated_from_fallback": updated_from_fallback,
        "unchanged": unchanged,
    }


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, ensure_ascii=False))
