from app.geometry import box_center, filter_detections_by_roi, point_in_rect


def test_box_center() -> None:
    assert box_center({"x": 10, "y": 20, "width": 10, "height": 10}) == (15.0, 25.0)
    assert box_center({"x": 0, "y": 0, "width": 4, "height": 8}) == (2.0, 4.0)


def test_point_in_rect_inside_edge_and_outside() -> None:
    rect = {"x": 0, "y": 0, "width": 10, "height": 10}
    assert point_in_rect((5, 5), rect) is True
    assert point_in_rect((0, 0), rect) is True
    assert point_in_rect((10, 10), rect) is True
    assert point_in_rect((11, 5), rect) is False
    assert point_in_rect((5, -0.1), rect) is False
    assert point_in_rect({"x": 2, "y": 8}, rect) is True


def test_filter_detections_by_roi() -> None:
    detections = [
        {
            "label": "person",
            "confidence": 0.92,
            "box": {"x": 0, "y": 0, "width": 10, "height": 10},
        },
        {
            "label": "cup",
            "confidence": 0.81,
            "box": {"x": 80, "y": 80, "width": 10, "height": 10},
        },
        {
            "label": "laptop",
            "confidence": 0.87,
            "box": {"x": 30, "y": 30, "width": 10, "height": 10},
        },
    ]
    roi = {"x": 0, "y": 0, "width": 20, "height": 20}

    assert [item["label"] for item in filter_detections_by_roi(detections, None)] == [
        "person",
        "cup",
        "laptop",
    ]
    assert [item["label"] for item in filter_detections_by_roi(detections, roi)] == [
        "person"
    ]

    edge = {
        "label": "person",
        "box": {"x": 15, "y": 15, "width": 10, "height": 10},
    }
    assert filter_detections_by_roi([edge], roi) == [edge]
