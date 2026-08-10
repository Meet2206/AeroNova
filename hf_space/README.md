---
title: Drone SAR - Aerial Person Detection
emoji: 🚁
colorFrom: red
colorTo: gray
sdk: gradio
sdk_version: 4.44.1
app_file: app.py
pinned: false
license: agpl-3.0
---

# Aerial Person Detection for Disaster Relief

Detects humans in drone imagery at the pixel scales produced by 50-100 m
flight altitude, and converts each detection into the GPS coordinate a
payload drop consumes.

Built for SIH: *AI based automatic alarm generation and dropping of payload at
a particular object through a drone.*

## The actual problem

A 1.7 m human at 100 m altitude is **9-34 px** tall depending on camera angle.
Feeding a 2304x1296 frame to YOLO at 640 px downscales that person to ~6 px --
below the network's stride-8 detection limit. The target is destroyed before
training starts.

The fix is tiled training and matched sliced inference, which is what this
model does.

## Configuration

Set `MODEL_REPO` as a Space variable to point at your fine-tuned weights
(default `Siddh10/sih-aerial-person`). If that repo has no `best.pt` yet, the
app falls back to stock COCO weights and says so — an honest baseline rather
than a broken Space.

## Hardware

Runs on free CPU. Sliced inference takes ~10 s per image and is off by
default. Training happens on Kaggle, not here — see the training repo.

## Licence

AGPL-3.0, inherited from Ultralytics YOLO.
