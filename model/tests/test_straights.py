import json
from pathlib import Path

import pytest

from f1battery_model import straights


def test_parse_sections_numbers_only_straights(tmp_path):
    f = tmp_path / "x.json"
    f.write_text(json.dumps([["Straight", 0.0, 13.06], ["Low", 13.06, 19.14],
                             ["Straight", 19.14, 34.18], ["High", 34.18, 100.0]]))
    assert straights.parse_sections(f) == [(1, 0.0, 13.06, "Straight"), (2, 19.14, 34.18, "Straight")]


def test_straight_crossing_the_line_is_merged_with_start_after_end(tmp_path):
    f = tmp_path / "x.json"
    f.write_text(json.dumps([["Straight", 0.0, 13.06], ["Low", 13.06, 19.14], ["Straight", 19.14, 34.18],
                             ["High", 34.18, 93.78], ["Straight", 93.78, 100.0]]))
    assert straights.parse_sections(f) == [(1, 93.78, 13.06, "Straight"), (2, 19.14, 34.18, "Straight")]


def test_window_mask_wraps_over_the_line():
    import numpy as np
    d = np.array([100.0, 5500.0, 5700.0, 800.0, 2000.0])
    m = straights.window_mask(d, 5400.0, 5760.0 + 750.0, 5760.0)
    assert m.tolist() == [True, True, True, False, False]
    assert straights.window_mask(d, 750.0, 900.0, 5760.0).tolist() == [False, False, False, True, False]


def test_mapping_covers_every_file_in_the_sections_directory():
    if not straights.SECTIONS_DIR.is_dir():
        pytest.skip("reference data not present (data/ is not in the repository)")
    stems = {p.stem for p in straights.SECTIONS_DIR.glob("*.json")}
    mapped = set(straights.SECTION_FILE_TO_CIRCUIT) | set(straights.UNUSED_SECTION_FILES)
    assert stems == mapped


def test_monza_straights_from_fixture_file():
    """Committed fixture in the TracingInsights sections schema; no dependence on data/."""
    rows = straights.parse_sections(Path(__file__).parent / "fixtures" / "sections" / "monza.json")
    assert len(rows) == 5 and rows[0][1] > rows[0][2] and rows[1][1:3] == (19.14, 34.18)
