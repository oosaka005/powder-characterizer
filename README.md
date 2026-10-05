# Powder Characterizer

> [!WARNING]
> **Hardware integration is not yet complete.**
>
> The physical wiring of the dispenser, Balance, and camera has not yet been
> corrected and verified. The software services and Web UI can be started, but
> commands that operate physical devices have not yet passed hardware
> acceptance testing. Do not assume that physical device control is currently
> available or safe.

## Current TODOs

- [ ] Correct and document the physical device wiring.
- [ ] Complete hardware acceptance tests for the dispenser, Balance, and camera.
- [ ] Validate the complete automated experiment and data-storage flow on the
      assembled instrument.
- [ ] Optimize and validate the angle-of-repose image-analysis algorithm against
      representative powders and imaging conditions.
- [ ] Review the granularity of the public SiLA 2 commands after hardware and
      external-system integration testing.
- [ ] Improve the first Web UI release, especially device-state visibility,
      operator guidance, validation, and error handling.

## Overview

Powder Characterizer is a Raspberry Pi-based system for automatically
evaluating powder flowability. It measures or derives:

- calibration mass per dispensing step;
- bulk density;
- tapped density;
- Hausner Ratio and Hausner Class; and
- angle of repose and repose class.

The production architecture uses two SiLA 2 layers. The upper process layer
implements the measurement algorithms and coordinates the experiment. The
lower device layer exposes the Balance, dispenser, and camera as independent
SiLA 2 devices.

Results can be reviewed in the Web UI and saved as JSON, CSV, and image
artifacts. Selected results can also be accumulated in the on-device Material
DB.

## System Architecture

```text
External SiLA 2 system                         Browser
          |                                      |
          | SiLA 2                               | HTTP / WebSocket
          |                                      v
          |                              Web UI Gateway (:8000)
          |                                      |
          |                                      | SiLA 2 client
          +------------------+-------------------+
                             v
              Layer 2 - Process / Application Layer
                Powder Characterizer Server (:50065)
            Measurement algorithms, workflow, state,
                 abort handling, and result handling
                             |
                             | SiLA 2 clients
             +---------------+---------------+
             |               |               |
             v               v               v
       Balance Server   Dispenser Server   Camera Server
          (:50052)         (:50063)         (:50064)
             |               |               |
             +---------------+---------------+
                             v
                    Layer 1 - Device Layer
             Device drivers / hardware interfaces
             |               |               |
          PySerial      I2C, GPIO,       rpicam-still
                       and MotorKit
             |               |               |
             v               v               v
          Balance         Dispenser         Camera
```

The Web UI Gateway is an HTTP/WebSocket-to-SiLA adapter. It is not a third
SiLA 2 layer.

### Layer 2: process and application control

The Powder Characterizer Server is the normal integration point for the Web UI
and external automation. It combines lower-level device commands into complete
measurement workflows, manages run state, propagates abort requests, and keeps
completed results pending until the operator saves or discards them.

External systems that want to run a powder characterization process should
normally connect to this server on port `50065`.

### Layer 1: device control

Each device server owns one physical device and exposes hardware operations
through a SiLA 2 feature:

- the Balance Server owns serial communication with the Balance;
- the Dispenser Server owns the Motor Bonnet, the I2C connection, and the index
  sensor on GPIO4; and
- the Camera Server owns camera capture.

Conceptually, each device server is a SiLA 2 wrapper around a device driver or
hardware API. The implementation is not always a thin wrapper around a legacy
Python file:

- the Dispenser Server contains a dedicated driver that preserves the motion
  constants and sequencing of `p_dispenser_HAT_api.py` while directly using
  I2C, GPIO, and MotorKit;
- the Camera Server contains a dedicated driver that invokes `rpicam-still` and
  returns the captured bytes; and
- the existing Balance Server, maintained in a separate repository, wraps its
  serial `BalanceInterface` driver.

Layer 1 servers may be called directly during device maintenance, diagnostics,
and hardware acceptance testing. Process-level integrations should use Layer 2
unless direct device access is specifically required.

## Processes and Ports

| Process | Default port | Layer | Responsibility |
|---|---:|---|---|
| Existing Balance Server | `50052` | Device | Serial Balance ownership |
| Powder Characterizer Dispenser Server | `50063` | Device | Motor Bonnet, I2C, and GPIO4 ownership |
| Powder Characterizer Camera Server | `50064` | Device | Camera ownership and image transport |
| Powder Characterizer Server | `50065` | Process | Measurement workflows, state, abort, and results |
| Web UI Gateway | `8000` | Gateway | Browser HTTP/WebSocket interface |

Server endpoints and ports are deployment environment variables. They are not
stored in `config/app_settings.json` and are not result or Material DB fields.
See `deploy/powder-flow.env.example`.

## Public SiLA 2 Interfaces

> [!IMPORTANT]
> The command names below match the identifiers currently exposed by the SiLA 2
> feature definitions. They document the current integration surface, not a
> permanently frozen API. The command boundaries and granularity may change as
> the physical instrument is validated and external-system requirements become
> clearer.

### Powder Characterizer Server (`:50065`)

Feature identifier: `PowderCharacterizer`

Definition:
`sila2_servers/powder_characterizer_server/PowderCharacterizer.sila.xml`

| Type | SiLA 2 identifier | Purpose |
|---|---|---|
| Property | `CurrentRun` | Return the current state, stage, progress, elapsed time, logs, result, and error as JSON. |
| Command | `RunAutomatedExperiment` | Run the complete powder-characterization workflow. |
| Command | `RunCalibration` | Run only the calibration workflow. |
| Command | `RunBulkDensity` | Run only the bulk-density workflow. |
| Command | `RunTappedDensity` | Run only the tapped-density workflow. |
| Command | `RunAngleOfRepose` | Run only the angle-of-repose workflow. |
| Command | `RunSingleTest` | Run a named single-test stage. |
| Command | `RunManualExperiment` | Run the current manual dispensing workflow. |
| Command | `ClearClog` | Run the fixed dispenser clog-clearing operation. |
| Command | `CaptureCameraPreview` | Capture a preview through the Camera Server. |
| Command | `CaptureReposePreview` | Capture and crop the repose preview. |
| Command | `AbortCurrentOperation` | Cancel the workflow and propagate `StopAll` to the Dispenser Server. |
| Command | `SaveResults` | Save the pending result and optionally update the Material DB. |
| Command | `DiscardResults` | Discard the pending result. |
| Command | `GetSettings` | Return the application settings JSON. |
| Command | `UpdateSettings` | Validate and persist the application settings JSON. |
| Command | `GetMaterialDatabase` | Return the Material DB JSON. |
| Command | `GetArtifact` | Return a pending or saved run artifact. |

The observable run commands provide intermediate state updates and a final
result. `CurrentRun` can also be polled when a client does not consume
intermediate responses.

### Powder Characterizer Dispenser Server (`:50063`)

Feature identifier: `PowderCharacterizerDispenser`

Definition:
`sila2_servers/powder_characterizer_dispenser_server/PowderCharacterizerDispenser.sila.xml`

| Type | SiLA 2 identifier | Purpose |
|---|---|---|
| Property | `Status` | Report `starting`, `discovering`, `waiting_for_device`, `ready`, `busy`, `recovering`, or `fault`. |
| Command | `IndexChamber` | Advance one chamber using the IR sensor and timeout protection. |
| Command | `Vibrate` | Run the vibration motor at a configured level for a duration. |
| Command | `VibrateWithAuger` | Run vibration and the forward auger together. |
| Command | `RunAllMotors` | Run M1, M2, and M3, then perform one indexed step. |
| Command | `StopAll` | Request cancellation and stop every motor. |
| Command | `Close` | Stop motors and release hardware resources during shutdown or maintenance. |

The dispenser does not use a configured I2C address or a hard-coded candidate
range. It scans the full bus, ignores `0x70` when it is the PCA9685 All Call
response, and accepts the one remaining individual address. No individual
device produces `waiting_for_device`; multiple individual addresses produce an
explicit ambiguity fault.

### Powder Characterizer Camera Server (`:50064`)

Feature identifier: `PowderCharacterizerCamera`

Definition:
`sila2_servers/powder_characterizer_camera_server/PowderCharacterizerCamera.sila.xml`

| Type | SiLA 2 identifier | Purpose |
|---|---|---|
| Property | `Status` | Report the Camera Server state. |
| Command | `Capture` | Capture a JPEG using requested rotation, autofocus mode, and lens position. |
| Command | `CaptureRepose` | Capture a PNG using the angle-of-repose camera settings. |

The commands return the original image bytes together with media type,
suggested filename, width, and height.

### Existing Balance Server (`:50052`)

Feature identifier used by this project: `Balance`

The Balance Server is maintained in the separate
`/home/sdl-5/balance_sila_server` repository. Powder Characterizer currently
uses the following interface:

| Type | SiLA 2 identifier | Purpose |
|---|---|---|
| Property | `Status` | Return the current Balance state. |
| Command | `ReadWeight` | Read a stabilized weight. |
| Command | `ReadWeightImmediate` | Read the current weight without the normal settling delay. |
| Command | `Tare` | Tare the Balance. |
| Command | `Close` | Close the Balance hardware connection; reserved for maintenance and server shutdown. |

Normal process workflows do not call `Balance.Close`. They close only their
SiLA client channel so that the shared Balance Server remains available for the
next experiment.

## Control Paths

### Web UI

The current Web UI always calls the Layer 2 Powder Characterizer Server. Even
operations that appear device-specific, such as manual dispensing, clog
clearing, and camera preview, are exposed as Layer 2 commands and delegated to
the appropriate Layer 1 server.

```text
Browser
  -> web_ui_gateway/app.py
  -> web_ui_gateway/sila_client.py
  -> Powder Characterizer Server
  -> selected device server or complete workflow
```

The browser does not connect directly to ports `50052`, `50063`, or `50064`.

### External automation

Process-level automation should use the `PowderCharacterizer` feature on port
`50065`. Direct Layer 1 connections remain available for diagnostics, device
commissioning, and acceptance testing.

### Legacy PySide GUI

The previous PySide GUI is retained for legacy development. It uses
`operation/local_devices.py` and accesses local hardware directly; it does not
use the Layer 2 SiLA 2 server. Do not run it at the same time as the production
SiLA 2 stack because both paths may attempt to own the same hardware.

## Web UI: Current Capabilities

The Web UI is the first browser-based version of the functionality that was
previously provided by the local PySide application. It is operational but is
expected to require further usability and hardware-integration improvements.

The current Web UI provides:

- experiment and material settings;
- complete automated evaluation;
- individual calibration, bulk-density, tapped-density, and angle-of-repose
  tests;
- manual dispensing and clog clearing;
- camera and repose previews;
- live run state, progress, elapsed time, and log updates;
- result JSON and generated image artifacts;
- save and discard actions, including optional Material DB updates; and
- Material DB viewing.

The experiment continues in the Powder Characterizer Server if the browser is
closed or temporarily disconnected. Reconnecting the browser retrieves the
current run state.

## Connecting to the Raspberry Pi

Connect the computer and Raspberry Pi to the same local network, then use:

```bash
ssh sdl-5@dispensercontroller.local
```

| Item | Value |
|---|---|
| Hostname | `dispensercontroller.local` |
| Username | `sdl-5` |

Credentials must be distributed separately and must not be stored in this
repository.

## Starting the Production Stack

The supported production path is the two-layer SiLA 2 stack plus the Web UI.
Deployment instructions and systemd unit files are in `deploy/`.

On the Raspberry Pi, the existing deployment checkout remains at
`/home/sdl-5/powder-flow` for compatibility with the installed systemd units.
The directory name does not need to match the GitHub repository name.

After the services are installed and `powder-flow.target` is enabled, open:

```text
Raspberry Pi: http://localhost:8000
Laptop:       http://dispensercontroller.local:8000
```

For gateway-only development, with all SiLA 2 servers already running:

```bash
./run_web.sh
```

The legacy desktop application can still be started for isolated development:

```bash
cd ~/powder-flow
./run_app_desktop.sh
```

It is not the production or hardware-acceptance path and must not run
concurrently with the SiLA 2 device servers.

## Result and Configuration Files

Results are held as pending data after a run. Selecting **Save Results** writes
the result files. Selecting **Update Material DB on save** also updates the
cumulative Material DB.

| Location | Contents |
|---|---|
| `logs/experiments/all/<run_id>/` | Complete automated result JSON, CSV files, plots, and images |
| `logs/experiments/single/<timestamp>_<material>_<stage>/` | Saved individual-test results |
| `config/material_database.json` | Cumulative per-material records, updated only when requested on save |
| `config/app_settings.json` | Current Web UI and workflow settings |
| `config/disk_master.csv` | Disk ID to volume lookup table |
| `config/P_calibration.csv` and `.json` | Calibration exports for external use |

## Repository Structure

```text
powder-characterizer/
|-- app/                         # Legacy PySide GUI
|-- config/                      # Settings, disk data, calibration, and Material DB
|-- deploy/                      # Raspberry Pi environment and systemd deployment
|-- hardware_api/                # Legacy/local hardware interfaces
|-- logs/                        # Saved experiment data
|-- operation/                   # Device-independent algorithms and workflows
|-- output/                      # Existing cross-run summary data
|-- service/                     # Settings, result storage, and plotting services
|-- sila2_servers/
|   |-- powder_characterizer_server/             # Layer 2 process server
|   |-- powder_characterizer_dispenser_server/   # Layer 1 dispenser server
|   `-- powder_characterizer_camera_server/      # Layer 1 camera server
|-- tests/                        # Automated software tests
|-- web_ui_gateway/               # FastAPI gateway and browser UI
|-- run_web.sh                    # Development Web UI launcher
|-- run_app.sh                    # Legacy application launcher
`-- requirements.txt
```

The Balance Server is intentionally not duplicated in this repository. The
existing `/home/sdl-5/balance_sila_server` checkout is started by the included
systemd service and used as the Layer 1 Balance service.

## GitHub Integration

Repository:
`https://github.com/oosaka005/powder-characterizer`

If code is changed directly on the Raspberry Pi, commit and push before ending
the session:

```bash
git add -A
git commit -m "Your name: brief description of the change"
git push
```

Automatic `git pull` at application startup is disabled. Apply remote updates
manually before restarting services:

```bash
cd ~/powder-flow
git pull --ff-only
```

The Raspberry Pi checkout may continue to use the directory name
`~/powder-flow`. After the GitHub repository is renamed, update its remote URL
once with:

```bash
git remote set-url origin https://github.com/oosaka005/powder-characterizer.git
```

Configuration and experiment data under `config/`, `logs/`, and `output/` are
currently tracked by Git. Review generated data before using `git add -A`.

If `git pull` reports a merge conflict, do not guess at a resolution. Preserve
the files and contact the person responsible for the codebase.

## Operational Precautions

- Do not operate physical hardware until wiring and hardware acceptance tests
  are complete.
- Load powder and install the correct disk before starting an experiment.
- Confirm that the selected Disk ID matches the physical disk.
- Only the Dispenser Server may own the Motor Bonnet during production use.
- Do not run the legacy PySide GUI while the SiLA 2 device servers are active.
- Use `AbortCurrentOperation` when an active workflow must be stopped, then
  inspect the mechanism before restarting.
- Run `RunCalibration` for a new material or after changing the disk before
  relying on density calculations.
- Review pending results and choose `SaveResults` or `DiscardResults` before
  starting another measurement.
- Treat direct Layer 1 commands as maintenance and acceptance-test operations;
  confirm that the physical area is safe before moving any device.
