from app.session_export import events_to_csv


def test_events_to_csv_header_and_one_row() -> None:
    events = [
        {
            "t": 12,
            "frame_id": 3,
            "detections": [
                {
                    "label": "person",
                    "confidence": 0.9,
                    "box": {"x": 1, "y": 2, "width": 3, "height": 4},
                }
            ],
            "counts": {"person": 1},
            "alerts": [],
            "latency_ms": 8.2,
        }
    ]

    csv_text = events_to_csv(events)
    lines = csv_text.strip().splitlines()

    assert lines[0] == "timestamp,frame_id,label,confidence,x,y,w,h"
    assert lines[1] == "12,3,person,0.9,1,2,3,4"
    assert len(lines) == 2
    assert csv_text.endswith("\n")


def test_events_to_csv_empty_events_is_header_only() -> None:
    csv_text = events_to_csv([])
    assert csv_text == "timestamp,frame_id,label,confidence,x,y,w,h\n"
