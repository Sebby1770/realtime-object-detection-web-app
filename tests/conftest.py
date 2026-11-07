import os

# Never download or load YOLO weights in the background during tests.
os.environ.setdefault("YOLO_WARMUP", "0")
