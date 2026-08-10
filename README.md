# Aerial Person Detection for Drone Disaster Relief

ML pipeline for the SIH problem statement *"AI based automatic alarm
generation and dropping of payload at a particular object through a drone."*

Detect humans from **50–100 m at a slant angle**, and turn each detection into
the **GPS coordinate** the payload drop consumes.

---

## The one thing that actually matters

Everything in this repo follows from a single number.

```
$ python -m src.gsd --preset picam3 --alt 50 100 --slant 0 45

  alt  slant   range      GSD  px(stand)  px(prone)   verdict
   50     0d     50m    2.82cm       17.7       60.3   HARD
   50    45d     71m    3.99cm       33.8       33.8   MODERATE
  100     0d    100m    5.64cm        8.9       30.2   VERY HARD
  100    45d    141m    7.97cm       16.9       16.9   HARD
```

**A human at 100 m is 9–34 pixels.**

Now consider what standard YOLO training does to that. A 2304×1296 frame fed
to the network at `imgsz=640` is downscaled 3.6×. Your 17 px person becomes
**4.7 px** — smaller than one cell of the stride-8 detection head. The target
is destroyed before the first forward pass. No number of epochs, no larger
model, and no amount of augmentation recovers information that a resize threw
away.

This is why most aerial-detection projects quietly fail, and why nearly every
design decision here is about **preserving pixel scale**.

Run `src/gsd.py` with *your* camera before quoting any numbers.

---

## How it works

```
   Full frame 2304x1296                Tiles 640x640, 20% overlap
  +---------------------+             +-----+-----+-----+-----+
  |        . <- 17px    |   tile.py   |     |  .  |     |     |   person is
  |                     |  ========>  +-----+-----+-----+-----+   STILL 17px,
  |                     |             |     |     |     |     |   but the input
  +---------------------+             +-----+-----+-----+-----+   is 3.6x smaller
     person = 4.7px at imgsz=640            => 3.6x larger relative to input

  TRAIN on tiles ------------------------------ INFER with matching slices
       (src/train.py)                                (src/infer.py)
                    ^                                      ^
                    +----- SAME tile size and overlap ------+
                          break this and recall collapses
```

**This is measured, not argued.** Same weights, same 12 VisDrone frames, the
only difference being whether inference was sliced:

| | overall recall @ IoU0.25 | 16–32 px bucket |
|---|---|---|
| **Sliced** (matched scale) | **0.336** | **0.296** |
| Full-frame (downscaled to 640) | 0.054 | 0.020 |

**15× worse recall on the target bucket.** And it fails *silently* — it reports
plausible-looking bad numbers, so the natural conclusion is "the model is
broken" when in fact the evaluation is. `src/eval.py` now refuses to run
full-frame on large images without `--sliced` for exactly this reason.

Then, per confirmed detection:

```
  detection bbox --> pixel_to_ground() --> lat/lon --> temporal confirmation
                     (camera model +        |            (3 hits in the same
                      gimbal pose +         |             GROUND location)
                      altitude AGL)         v
                                      alarm + descend to 10-15 m + release
```

---

## Design decisions and why

| Decision | Reason |
|---|---|
| **Offline tiling, not full-frame training** | The whole ballgame. See above. |
| **Slice at inference with the *same* scale** | Train/test scale mismatch is the #1 silent killer in aerial detection. |
| **Single `person` class** | A rescue drone does not care if the victim is standing or prone. Merging VisDrone's `pedestrian` + `people` roughly doubles positives per class. |
| **Mask VisDrone `ignored-regions`** | Class 0 is crowd blobs, not objects. Training on them is garbage; *dropping* them is also wrong, since real unlabelled people live inside and the model gets punished for finding them. We mask the pixels instead. |
| **Drop `occlusion == 2` boxes** | A 50–100 % hidden person at 20 px is label noise, not a learnable target. |
| **Keep ~8 % empty tiles in train, **all** in val** | Zero negatives → the model fires on every rock. All negatives → positives get buried. Val must keep them all, because false positives happen on empty ground and an eval set without empty ground cannot measure them. |
| **`degrees=180, flipud=0.5`** | Overhead imagery has no canonical "up". COCO defaults assume upright people; that assumption is simply false here. |
| **`scale=0.3` (default 0.5)** | Default scale jitter shrinks a 20 px person to 10 px — below the model's own detection limit. Wasted capacity. |
| **`close_mosaic=15`** | Mosaic helps small-object density but creates unrealistic seams; disabling it near the end reliably buys AP. |
| **`erasing=0.0`** | Random erasing deletes small targets *entirely*. |
| **Recall over precision, IoU 0.25 not 0.5** | A false alarm costs a wasted flower. A miss costs a life. At 20 px a 3 px offset drops IoU below 0.5 and gets scored as both a miss *and* a false positive — while operationally being a complete success. |
| **Low `conf` + temporal confirmation** | Rather than raising the threshold (which throws away real small detections), run at `conf=0.15` and require 3 hits in the same **ground** location. Clustering in ground rather than image space is the point: the drone moves, the victim does not. |
| **Two-stage inference** | Slicing costs ~10× — fatal on a Pi. So: nano model full-frame as a cheap continuous scan; sliced high-recall pass only on triggered keyframes. |

---

## Quickstart

```bash
python -m venv .venv && .venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

> Install torch **first** from the CUDA index. Installing `ultralytics` first
> pulls the CPU-only wheel and you will train 40× slower with no error message
> telling you why.

Verify the whole pipeline before spending GPU hours:

```bash
python -m src.test_geo           # geo-projection sign conventions
python -m src.test_tile          # tiling + temporal confirmation
python -m src.test_space_parity  # demo Space matches flight code
```

Then:

```bash
python scripts/get_data.py --splits train val
python -m src.prepare_visdrone --src data/raw/VisDrone2019-DET-train --dst data/yolo/train
python -m src.prepare_visdrone --src data/raw/VisDrone2019-DET-val   --dst data/yolo/val
python -m src.tile --src data/yolo/train --dst data/tiled/train
python -m src.tile --src data/yolo/val   --dst data/tiled/val --keep-empty-ratio 1.0
python -m src.train --model yolo11s.pt --epochs 100

# evaluate on tiles (the default)
python -m src.eval --weights runs/aerial_person/weights/best.pt

# evaluate on full frames the way the drone actually sees them
python -m src.eval --weights runs/aerial_person/weights/best.pt \
    --images data/yolo/val/images --sliced
```

## Current state

The **pipeline is verified end to end; the model is not trained yet.** What has
actually been run:

* VisDrone val converted and tiled: 541 frames → 2,798 tiles, **zero boxes
  lost**, median box size preserved at 26 px (full-frame training would have
  shrunk it to ~7 px).
* A 2-epoch smoke run on an RTX 4050 converges (mAP50 0.13 → 0.24) — enough to
  prove the loop, meaningless as a result.
* The evaluator reproduces the expected physics gradient across size buckets
  (recall 0.10 / 0.25 / 0.43 / 0.54), which is the check that it measures the
  right thing.
* Sliced-vs-full-frame gap measured at 15× (table above).
* All three test suites green.

**The real training run is yours to launch on Kaggle** — it needs your
`HF_TOKEN` in Kaggle Secrets, which cannot be set from here.

---

## Training on Kaggle (recommended)

**Not HF Spaces.** HF has no free GPU; ZeroGPU caps a call at a few minutes
(inference-shaped, not training-shaped), and paid GPU Spaces have ephemeral
storage and restart on push, so a crash loses the run. Kaggle gives **30 free
GPU-hours/week, 12-hour sessions, and persistent output** — better than most
laptop GPUs, for free.

In a Kaggle notebook:

1. *Settings → Accelerator →* **GPU P100**
2. *Settings → Internet →* **ON**
3. *Add-ons → Secrets →* add **`HF_TOKEN`** (a **write** token from
   huggingface.co/settings/tokens)

```python
!git clone https://github.com/<you>/sih-drone-vision /kaggle/working/repo
%cd /kaggle/working/repo
!pip install -q ultralytics gdown
!python kaggle/kaggle_train.py --epochs 100 --hf-repo Siddh10/sih-aerial-person
```

The 12-hour wall is real — ~100 epochs on ~30 k tiles is 6–9 h on a P100. The
script **pushes `best.pt` to the Hub every 10 epochs**, so a killed session
resumes instead of vanishing. Do not skip the `HF_TOKEN` step.

---

## Demo Space (HF)

`hf_space/` is a Gradio app for **free CPU** hardware — the `Siddh10` account
is free tier, so no GPU and no ZeroGPU. It is built around that constraint:
single image in, slicing off by default with a stated time cost, nano model
default.

It shows detections labelled with **pixel height**, a size histogram against
the operating-regime buckets, and the **GPS coordinate** per target. That last
panel is what connects computer vision to the mission, and it is what most SIH
drone entries are missing.

```bash
huggingface-cli login
huggingface-cli repo create sih-drone-rescue --type space --space_sdk gradio
git clone https://huggingface.co/spaces/Siddh10/sih-drone-rescue
cp hf_space/* sih-drone-rescue/ && cd sih-drone-rescue
git add -A && git commit -m "aerial person detection demo" && git push
```

Before the Kaggle run finishes the Space falls back to stock COCO weights and
**says so on screen** — an honest baseline rather than a broken Space.

---

## Evaluation: read the size buckets, not the headline

`python -m src.eval` deliberately does not lead with mAP50-95, because
averaging hides the failure. A val set where most people are 60 px and a few
are 15 px yields a respectable mAP carried **entirely by the easy boxes** —
while the 15 px boxes *are* the product.

```
  RECALL BY TARGET SIZE @ IoU0.25   (this is the table that matters)
  bucket                                     gt  found   recall
  tiny   <16px  (~100m nadir)              ...    ...      ...
  small  16-32px (~100m slant / 50m nadir) ...    ...      ...
  medium 32-64px (~50m slant)              ...    ...      ...
  large  >=64px  (<30m)                    ...    ...      ...
```

**You cannot validate "50–100 m" directly** — VisDrone has no altitude labels.
So make the honest claim: performance at *the box sizes corresponding to*
50–100 m per your own GSD calculation. Stating that reads as rigour, not
weakness.

---

## Deployment

```bash
python -m src.export --weights runs/aerial_person/weights/best.pt --target ncnn      # RPi 4/5
python -m src.export --weights ... --target openvino                                  # Intel NUC
python -m src.export --weights ... --target onnx                                      # portable
```

A TensorRT `.engine` is tied to the exact GPU and TensorRT version that built
it — **you must export it on the Jetson itself.** Exporting on a laptop
produces a file the Jetson cannot load. This is the most common deployment
mistake in this space.

INT8 quantisation costs real recall on 20 px targets. If you quantise, re-run
`src/eval.py` and check the **<32 px bucket specifically** — a quantisation
that costs 2 points of overall mAP can cost 15 points of tiny-object recall.

---

## Honest limitations

State these before a judge finds them.

* **VisDrone is urban drone footage, not disaster footage.** There is a real
  domain gap to flood and earthquake scenes. Do not imply otherwise.
* **Below ~16 px, recall is poor.** That is optics, not model quality. The fix
  is a longer lens, lower altitude, or thermal — not more epochs.
* **Geo-location assumes locally flat terrain.** Sub-metre over flooded
  plains; tens of metres in hills.
* **`alt_agl_m` must be height above *ground*,** not above sea level. Passing
  AMSL is a classic bug that puts the payload hundreds of metres off in
  terrain.
* **`haversine_m` loses precision below ~1 m** (catastrophic cancellation in
  the `1−cos` term). Fine for the 8 m association radius it is used for; do
  not reuse it for sub-metre work.
* **Ultralytics YOLO is AGPL-3.0.** Not a blocker for SIH, but be ready for
  the question given the DRDO framing.

## The highest-value work remaining

**Fly your own drone and annotate 200–500 frames.** Your camera, your
altitudes, your terrain, people both standing and lying down. That will beat
10 k VisDrone images for demo-day performance because it removes the domain
gap entirely. Budget a day. Fine-tune on it *last*, after the VisDrone
pretrain. This is the single difference between a model that works on demo day
and one that does not.

---

## Repo map

```
src/gsd.py                 target pixel size calculator -- START HERE
src/prepare_visdrone.py    VisDrone -> YOLO, ignore-region + occlusion handling
src/tile.py                offline tiling with label remapping
src/train.py               training, with per-hyperparameter rationale
src/eval.py                size-bucketed, recall-first evaluation
src/infer.py               sliced inference + temporal confirmation + geo-location
src/export.py              ncnn / openvino / onnx / tensorrt export
src/test_geo.py            geo-projection sign conventions
src/test_tile.py           tiling correctness + confirmer behaviour
src/test_space_parity.py   demo Space vs flight code
kaggle/kaggle_train.py     free-GPU training with Hub checkpointing
hf_space/                  Gradio demo for free CPU hardware
scripts/get_data.py        dataset download + notes on every candidate dataset
```
