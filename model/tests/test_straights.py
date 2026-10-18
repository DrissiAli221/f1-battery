import json

from f1battery_model import straights


def test_parse_sections_numbers_only_straights(tmp_path):
    f = tmp_path / "x.json"
    f.write_text(json.dumps([["Straight", 0.0, 13.06], ["Low", 13.06, 19.14],
                             ["Straight", 19.14, 34.18], ["High", 34.18, 100.0]]))
    assert straights.parse_sections(f) == [(1, 0.0, 13.06, "Straight"), (2, 19.14, 34.18, "Straight")]


def test_mapping_covers_every_file_in_the_sections_directory():
    stems = {p.stem for p in straights.SECTIONS_DIR.glob("*.json")}
    mapped = set(straights.SECTION_FILE_TO_CIRCUIT) | set(straights.UNUSED_SECTION_FILES)
    assert stems == mapped


def test_monza_straights_from_real_file():
    rows = straights.parse_sections(straights.SECTIONS_DIR / "monza.json")
    assert len(rows) == 6 and rows[1][1:3] == (19.14, 34.18)
