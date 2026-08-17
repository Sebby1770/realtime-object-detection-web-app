from __future__ import annotations

import os

import cv2
import numpy as np
import pytest

os.environ["YOLO_MOCK"] = "1"

from app.detector import load_model  # noqa: E402
from app.stats import stats  # noqa: E402


@pytest.fixture(autouse=True)
def _force_mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOLO_MOCK", "1")
    load_model.cache_clear()
    stats.reset()
    yield
    load_model.cache_clear()


@pytest.fixture
def jpeg_bytes() -> bytes:
    image = np.zeros((240, 320, 3), dtype=np.uint8)
    image[:, :] = (36, 40, 48)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()
