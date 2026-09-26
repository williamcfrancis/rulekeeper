from rulekeeper.ingest import clean_text, layout_lines


def character(text, x, baseline, font="Cambria", size=10, top=0):
    return {
        "text": text,
        "x0": x,
        "x1": x + 5,
        "matrix": (1, 0, 0, 1, x, baseline),
        "fontname": font,
        "size": size,
        "top": top,
    }


def test_baselines_prevent_mixed_font_line_corruption():
    # Italics may have a different bounding-box top even on the same baseline.
    chars = [
        character("No Concentration.", 63, 700, "Cambria-BoldItalic", top=79),
        character("Your concentration is broken.", 155, 700, top=91),
        character("You can't speak.", 63, 688, top=79),
    ]
    lines = layout_lines(chars, 792, 0, 297)
    assert lines[0]["text"] == "No Concentration. Your concentration is broken."
    assert lines[1]["text"] == "You can't speak."


def test_columns_and_footer_are_separate():
    chars = [
        character("left rule", 63, 65),
        character("right rule", 315, 65),
        character("footer", 63, 25),
    ]
    assert [line["text"] for line in layout_lines(chars, 792, 0, 297)] == ["left rule"]
    assert [line["text"] for line in layout_lines(chars, 792, 297, 594)] == ["right rule"]


def test_dehyphenation_preserves_normal_hyphens():
    assert (
        clean_text("concen-\ntration and three-quarters\ncover")
        == "concentration and three-quarters cover"
    )
